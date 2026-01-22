# Asynchronous Order Processing Microservice

![Node.js](https://img.shields.io/badge/Node.js-v18-green) ![RabbitMQ](https://img.shields.io/badge/RabbitMQ-3.13-orange) ![MySQL](https://img.shields.io/badge/MySQL-8.0-blue) ![Docker](https://img.shields.io/badge/Docker-Compose-2496ED)

A robust, event-driven backend system demonstrating the **Microservices** architectural pattern. This project decouples order submission from processing using **RabbitMQ**, ensuring high availability and system resilience. It features advanced distributed system patterns including **Idempotency**, **Dead Letter Queues (DLQ)**, and **Exponential Backoff Retries**.

---

## 🚀 Features

* **Microservices Architecture:** Clean separation of concerns between the API (Producer) and the Worker (Consumer).
* **Asynchronous Processing:** Offloads heavy business logic to background workers to maintain high API responsiveness.
* **Reliability & Fault Tolerance:**
    * **Idempotency:** Prevents duplicate processing of orders using a dedicated state tracking table (`processed_messages`), ensuring data integrity even during message redelivery.
    * **Automated Retries:** Implements a retry mechanism with a Time-To-Live (TTL) delay loop for transient failures.
    * **Dead Letter Queue (DLQ):** Automatically isolates messages that fail after maximum retry attempts for manual inspection.
* **Infrastructure as Code:** Fully containerized environment using Docker and Docker Compose for one-command setup.

---

## 📂 Architecture Overview

The system consists of two primary services and infrastructure components:

1.  **API Service (Producer):**
    * Accepts HTTP `POST` requests.
    * Validates input payload.
    * Persists the initial order state (`PENDING`) to MySQL.
    * Publishes an `OrderSubmitted` event to the `order_exchange`.
    * Returns an immediate `202 Accepted` response.

2.  **Consumer Service (Worker):**
    * Listens to the `order_processing_queue`.
    * **Step 1:** Checks the database for Idempotency (has this `orderId` been processed?).
    * **Step 2:** Updates order status to `PROCESSING`.
    * **Step 3:** Executes business logic (simulated).
    * **Step 4:** Updates status to `COMPLETED` and marks the message as processed.
    * **Error Handling:** If processing fails, it NACKs the message to trigger the Retry Loop.

### 🔄 Message Flow (The Retry Loop)

1.  **Main Flow:** `order_exchange` → `order_processing_queue` → **Consumer**.
2.  **Retry Flow:** If Consumer `NACKs` → `order_dlx` (Dead Letter Exchange) → `order_retry_queue` (5s TTL) → **Back to Main Exchange**.
3.  **Failure Flow:** After 3 failed attempts → `order_failed_queue` (Manual Intervention).

---

## 🛠️ Tech Stack

* **Runtime:** Node.js (Express.js)
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

### 2. Get Order Status
Retrieves the current status and details of a specific order.

* **Endpoint:** `GET /api/orders/:orderId`
* **Success Response (200 OK):**
    ```json
    {
      "order_id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
      "user_id": "user-123",
      "status": "COMPLETED",
      "retry_count": 0,
      "created_at": "...",
      "updated_at": "..."
    }
    ```

---

## 🧪 Testing & Verification

### automated Tests
Run the comprehensive test suites inside the Docker containers:

**API Tests (Validation & Endpoints):**
```bash
docker-compose exec api-service npm test

```

**Consumer Tests (Logic & Mocks):**

```bash
docker-compose exec consumer-service npm test

```

### Manual Verification

1. **Access RabbitMQ Dashboard:**
* URL: [http://localhost:15672](https://www.google.com/search?q=http://localhost:15672)
* User: `guest`
* Password: `guest`


2. **Trigger a Failure (Test Retry Logic):**
Send an order with quantity `999` (configured to fail in `consumer.js`).
```bash
curl -X POST http://localhost:3000/api/orders \
     -H "Content-Type: application/json" \
     -d '{"userId": "test", "productId": "fail", "quantity": 999}'

```


* **Observation:** In the RabbitMQ dashboard, watch the message move from `order_processing_queue` -> `order_retry_queue` -> wait 5s -> back to `processing` -> finally to `order_failed_queue`.



---

## 💾 Database Schema

**`orders` Table:**
| Column | Type | Description |
| :--- | :--- | :--- |
| `order_id` | VARCHAR(36) | Primary Key (UUID) |
| `status` | VARCHAR(50) | PENDING, PROCESSING, COMPLETED, FAILED |
| `retry_count` | INT | Tracks attempts for logic (Max 3) |

**`processed_messages` Table:**
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | VARCHAR(36) | Stores `orderId` to ensure Idempotency |

---

