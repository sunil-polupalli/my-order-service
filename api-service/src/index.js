const express = require('express');
const amqp = require('amqplib');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const PORT = 3000;
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';
const DATABASE_URL = process.env.DATABASE_URL; 

let channel;
let dbConnection;

async function connectRabbitMQ() {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        channel = await connection.createChannel();
        await channel.assertExchange('order_exchange', 'direct', { durable: true });
        console.log('Connected to RabbitMQ');
    } catch (error) {
        console.error('RabbitMQ connection error:', error);
        setTimeout(connectRabbitMQ, 5000);
    }
}

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
        console.error('MySQL connection error:', error);
        setTimeout(connectDB, 5000);
    }
}

app.post('/api/orders', async (req, res) => {
    const { userId, productId, quantity } = req.body;

    if (!userId || !productId || !quantity || quantity <= 0) {
        return res.status(400).json({ error: 'Invalid input' });
    }

    const orderId = uuidv4();
    const order = {
        orderId,
        userId,
        productId,
        quantity,
        status: 'PENDING',
        timestamp: new Date().toISOString()
    };

    try {
        await dbConnection.execute(
            'INSERT INTO orders (order_id, user_id, product_id, quantity, status) VALUES (?, ?, ?, ?, ?)',
            [orderId, userId, productId, quantity, 'PENDING']
        );

        if (channel) {
            channel.publish(
                'order_exchange',
                'order.submitted',
                Buffer.from(JSON.stringify(order))
            );
        }

        res.status(202).json({
            message: 'Order received for processing',
            orderId: orderId
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/api/orders/:orderId', async (req, res) => {
    try {
        const [rows] = await dbConnection.execute(
            'SELECT * FROM orders WHERE order_id = ?',
            [req.params.orderId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.listen(PORT, async () => {
    console.log(`API Service running on port ${PORT}`);
    await connectRabbitMQ();
    await connectDB();
});