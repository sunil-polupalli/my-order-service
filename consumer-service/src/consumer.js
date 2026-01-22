const amqp = require('amqplib');
const mysql = require('mysql2/promise');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';
const DATABASE_URL = process.env.DATABASE_URL;

const EXCHANGE_NAME = 'order_exchange';
const DLX_NAME = 'order_dlx';
const QUEUE_NAME = 'order_processing_queue';
const RETRY_QUEUE_NAME = 'order_retry_queue';
const FAILED_QUEUE_NAME = 'order_failed_queue';
const MAX_RETRIES = 3;

let channel;
let dbConnection;

async function connectDB() {
    try {
        dbConnection = await mysql.createPool({
            uri: DATABASE_URL,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });
        console.log('Connected to MySQL');
    } catch (error) {
        console.error('MySQL connection error, retrying...', error);
        setTimeout(connectDB, 5000);
    }
}

async function connectRabbitMQ() {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        channel = await connection.createChannel();
        
        // 1. Assert Exchanges
        await channel.assertExchange(EXCHANGE_NAME, 'direct', { durable: true });
        await channel.assertExchange(DLX_NAME, 'direct', { durable: true });

        // 2. Assert Main Queue (Dead Letter points to DLX)
        await channel.assertQueue(QUEUE_NAME, {
            durable: true,
            arguments: {
                'x-dead-letter-exchange': DLX_NAME,
                'x-dead-letter-routing-key': 'order.retry'
            }
        });
        await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'order.submitted');

        // 3. Assert Retry Queue (TTL 5s, Dead Letter points BACK to Main Exchange)
        await channel.assertQueue(RETRY_QUEUE_NAME, {
            durable: true,
            arguments: {
                'x-message-ttl': 5000, 
                'x-dead-letter-exchange': EXCHANGE_NAME,
                'x-dead-letter-routing-key': 'order.submitted'
            }
        });
        await channel.bindQueue(RETRY_QUEUE_NAME, DLX_NAME, 'order.retry');

        // 4. Assert Failed Queue
        await channel.assertQueue(FAILED_QUEUE_NAME, { durable: true });
        await channel.bindQueue(FAILED_QUEUE_NAME, DLX_NAME, 'order.failed');

        console.log('RabbitMQ Topology Setup Complete');
        
        // Start Consuming
        channel.consume(QUEUE_NAME, processMessage);
        
    } catch (error) {
        console.error('RabbitMQ connection error, retrying...', error);
        setTimeout(connectRabbitMQ, 5000);
    }
}

async function processMessage(msg) {
    if (!msg) return;

    const content = JSON.parse(msg.content.toString());
    const { orderId } = content;
    console.log(`Received order: ${orderId}`);

    try {
        // IDEMPOTENCY CHECK
        const [existing] = await dbConnection.execute(
            'SELECT id FROM processed_messages WHERE id = ?', 
            [orderId]
        );

        if (existing.length > 0) {
            console.log(`Order ${orderId} already processed. Skipping.`);
            channel.ack(msg);
            return;
        }

        // UPDATE STATUS TO PROCESSING
        await dbConnection.execute(
            'UPDATE orders SET status = "PROCESSING" WHERE order_id = ?',
            [orderId]
        );

        // SIMULATE WORK (and potentially fail for testing)
        // if (content.quantity === 999) throw new Error("Simulated Failure");

        // SUCCESS: UPDATE DB
        await dbConnection.execute(
            'UPDATE orders SET status = "COMPLETED" WHERE order_id = ?',
            [orderId]
        );
        
        // MARK AS PROCESSED (Idempotency)
        await dbConnection.execute(
            'INSERT INTO processed_messages (id) VALUES (?)',
            [orderId]
        );

        console.log(`Order ${orderId} COMPLETED`);
        channel.ack(msg);

    } catch (error) {
        console.error(`Error processing order ${orderId}:`, error.message);

        // CHECK RETRY COUNT IN DB
        const [rows] = await dbConnection.execute(
            'SELECT retry_count FROM orders WHERE order_id = ?',
            [orderId]
        );
        
        const currentRetry = rows[0] ? rows[0].retry_count : 0;

        if (currentRetry >= MAX_RETRIES) {
            console.error(`Max retries reached for ${orderId}. Moving to FAILED queue.`);
            
            await dbConnection.execute(
                'UPDATE orders SET status = "FAILED" WHERE order_id = ?',
                [orderId]
            );

            // Publish to Failed Queue manually to stop the loop
            channel.publish(DLX_NAME, 'order.failed', msg.content);
            channel.ack(msg); // Ack from main queue so it leaves there
        } else {
            console.log(`Retrying order ${orderId} (Attempt ${currentRetry + 1})`);
            
            await dbConnection.execute(
                'UPDATE orders SET retry_count = retry_count + 1 WHERE order_id = ?',
                [orderId]
            );

            // NACK triggers the Dead Letter policy -> Sends to DLX -> Retry Queue
            channel.nack(msg, false, false);
        }
    }
}

connectDB().then(() => connectRabbitMQ());