const request = require('supertest');
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const mockChannel = {
    publish: jest.fn(),
    assertExchange: jest.fn()
};

jest.mock('amqplib', () => ({
    connect: jest.fn(() => ({
        createChannel: jest.fn(() => mockChannel)
    }))
}));

jest.mock('mysql2/promise', () => ({
    createPool: jest.fn(() => ({
        execute: jest.fn()
    }))
}));

app.post('/api/orders', (req, res) => {
    const { userId, productId, quantity } = req.body;
    if (!userId || !productId || !quantity || quantity <= 0) {
        return res.status(400).json({ error: 'Invalid input' });
    }
    const orderId = uuidv4();
    res.status(202).json({ message: 'Order received', orderId });
});

describe('POST /api/orders', () => {
    it('should return 202 and an orderId for valid input', async () => {
        const res = await request(app)
            .post('/api/orders')
            .send({
                userId: 'user123',
                productId: 'prod123',
                quantity: 1
            });
        
        expect(res.statusCode).toEqual(202);
        expect(res.body).toHaveProperty('orderId');
    });

    it('should return 400 for invalid quantity', async () => {
        const res = await request(app)
            .post('/api/orders')
            .send({
                userId: 'user123',
                productId: 'prod123',
                quantity: -5
            });
        
        expect(res.statusCode).toEqual(400);
    });

    it('should return 400 for missing fields', async () => {
        const res = await request(app)
            .post('/api/orders')
            .send({
                userId: 'user123'
            });
        
        expect(res.statusCode).toEqual(400);
    });
});