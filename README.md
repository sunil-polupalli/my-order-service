# Asynchronous Order Processing Microservice

![Node.js](https://img.shields.io/badge/Node.js-18-green) ![RabbitMQ](https://img.shields.io/badge/RabbitMQ-3.13-orange) ![MySQL](https://img.shields.io/badge/MySQL-8.0-blue) ![Docker](https://img.shields.io/badge/Docker-Compose-2496ED)

A robust, event-driven backend system demonstrating the **Microservices** architectural pattern. This project decouples order submission from processing using **RabbitMQ**, ensuring high availability and system resilience. It features advanced distributed system patterns including **Idempotency**, **Dead Letter Queues (DLQ)**, and **Exponential Backoff Retries**.

---

## 🚀 Features

* **Microservices Architecture:** Clean separation of concerns between the API Service (Producer) and the Consumer Service (Worker).
* **Asynchronous Processing:** Offloads heavy business logic to background workers to maintain high API responsiveness.
* **Reliability & Fault Tolerance:**
    * **Idempotency:** Prevents duplicate processing of orders using a dedicated state tracking table (`processed_messages`), ensuring data integrity even during message redelivery.
    * **Automated Retries:** Implements a retry mechanism with a 5-second Time-To-Live (TTL) delay loop for transient failures.
    * **Dead Letter Queue (DLQ):** Automatically isolates messages that fail after 3 retry attempts for manual inspection.
* **Infrastructure as Code:** Fully containerized environment using Docker and Docker Compose for one-command setup.

---

## 📂 Architecture Overview

The system consists of two primary services and infrastructure components:

### 1. API Service (Producer)
* **Role:** Entry point for client requests.
* **Behavior:** Accepts HTTP `POST` requests, validates input, persists the initial order state (`PENDING`) to MySQL, publishes an `OrderSubmitted` event to the `order_exchange`, and returns an immediate `202 Accepted` response.

### 2. Consumer Service (Worker)
* **Role:** Background processor.
* **Behavior:** Listens to the `order_processing_queue`.
    1.  **Idempotency Check:** Queries the `processed_messages` table to see if the `orderId` has already been handled.
    2.  **Processing:** Updates order status to `PROCESSING` -> Simulates work -> Updates status to `COMPLETED`.
    3.  **Finalize:** Inserts the `orderId` into `processed_messages` and Acknowledges (`ACK`) the message.

### 🔄 RabbitMQ Topology & Retry Flow
The system uses a sophisticated "Retry Loop" configuration defined in `consumer.js`:

1.  **Main Flow:** `order_exchange` (Direct) → `order_processing_queue` → Consumer.
2.  **Retry Flow:**
    * If processing fails, the Consumer checks the `retry_count` in the database.
    * If `retry_count < 3`: The Consumer **NACKs** the message.
    * RabbitMQ routes the NACKed message via `order_dlx` (Dead Letter Exchange) to the `order_retry_queue`.
    * **TTL:** The message sits in `order_retry_queue` for **5000ms** (5 seconds).
    * **Re-queue:** After TTL expires, it is dead-lettered *back* to `order_exchange` and re-enters the processing queue.
3.  **Failure Flow:**
    * If `retry_count >= 3`: The Consumer updates the status to `FAILED`, manually publishes the message to the `order_failed_queue` via `order_dlx`, and ACKs the original message to remove it from the loop.

---

## 🛠️ Tech Stack

* **Runtime:** Node.js (v18 Alpine)
* **Message Broker:** RabbitMQ (Management Plugin enabled)
* **Database:** MySQL 8.0
* **Containerization:** Docker, Docker Compose
* **Testing:** Jest, Supertest

---

## ⚙️ Setup & Installation

### Prerequisites
* Docker & Docker Compose installed on your machine.

### Running the Application
1.  **Clone the repository:**
    ```bash
    git clone https://github.com/sunil-polupalli/my-order-service.git
    cd my-order-service
    ```

2.  **Start the services:**
    This command builds the images and starts the containers in detached mode.
    ```bash
    docker-compose up -d --build
    ```

3.  **Verify Status:**
    Ensure all 4 containers (`api-service`, `consumer-service`, `rabbitmq`, `database`) are healthy.
    ```bash
    docker-compose ps
    ```

---

## 🔌 API Documentation

### 1. Submit Order
Submits a new order for asynchronous processing.

* **Endpoint:** `POST /api/orders`
* **Content-Type:** `application/json`
* **Body:**
    ```json
    {
      "userId": "user-123",
      "productId": "prod-abc",
      "quantity": 1
    }
    ```
* **Success Response (202 Accepted):**
    ```json
    {
      "message": "Order received for processing",
      "orderId": "a1b2c3d4-e5f6-7890-1234-567890abcdef"
    }
    ```
* **Error Response (400 Bad Request):**
    ```json
    { "error": "Invalid input" }
    ```

### 2. Get Order Status
Retrieves the current status and details of a specific order.

* **Endpoint:** `GET /api/orders/:orderId`
* **Success Response (200 OK):**
    ```json
    {
      "order_id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
      "user_id": "user-123",
      "product_id": "prod-abc",
      "quantity": 1,
      "status": "COMPLETED",
      "retry_count": 0,
      "created_at": "2024-01-22T10:00:00.000Z",
      "updated_at": "2024-01-22T10:00:05.000Z"
    }
    ```
* **Error Response (404 Not Found):**
    ```json
    { "error": "Order not found" }
    ```

---

## 🧪 Testing

The project includes comprehensive test suites that run inside the Docker containers.

**1. API Service Tests**
Verifies input validation and endpoint responses.
```bash
docker-compose exec api-service npm test

```

**2. Consumer Service Tests**
Verifies the logic flow, including mocking database and RabbitMQ interactions.

```bash
docker-compose exec consumer-service npm test

```

---

## 💾 Database Schema

The system uses two main tables as defined in `schema.sql`:

**`orders` Table:**
| Column | Type | Description |
| :--- | :--- | :--- |
| `order_id` | VARCHAR(36) | Primary Key (UUID) |
| `user_id` | VARCHAR(255) | User identifier |
| `product_id` | VARCHAR(255) | Product identifier |
| `quantity` | INT | Order quantity |
| `status` | VARCHAR(50) | `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED` |
| `retry_count` | INT | Tracks attempts for logic (Default 0) |

**`processed_messages` Table:**
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | VARCHAR(36) | Stores `orderId` to ensure Idempotency |

---

## 📊 Monitoring

You can monitor the message queues and exchanges in real-time using the RabbitMQ Management Interface:

* **URL:** [http://localhost:15672](https://www.google.com/search?q=http://localhost:15672)
* **Username:** `guest`
* **Password:** `guest`

Navigate to the **Queues** tab to watch `order_processing_queue`, `order_retry_queue`, and `order_failed_queue` in action.

