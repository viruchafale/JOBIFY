# Jobify - AI-Powered Microservices Job Portal

Jobify is a robust, scalable, and modern job portal application built using a microservices architecture. It streamlines the connection between recruiters and job seekers with a seamless, event-driven backend and a high-performance frontend.

## 🚀 Key Features

-   **Microservices Architecture**: Split into functional services for better scalability and maintainability.
-   **Role-Based Access Control**: Separate flows for **Recruiters** (posting jobs, managing companies, tracking applications) and **Jobseekers** (searching jobs, applying, managing profiles).
-   **Kafka Event-Driven Communication**: Asynchronous communication for tasks like sending automated emails upon application status updates or password resets.
-   **Redis Integration**: Utilized for efficient caching and managing short-lived tokens (e.g., password reset tokens).
-   **Full-Text Search & Filtering**: Sophisticated job search by title, location, and other parameters.
-   **Cloud-Ready File Management**: Dedicated service for handling resume and logo uploads.
-   **Modern UI/UX**: Built with Next.js, Tailwind CSS, and Shadcn UI for a premium, responsive experience.

---

## 🏗️ Architecture Overview

The project is structured as a collection of independent services that communicate via REST APIs and Kafka events.

### 🛠️ Tech Stack

-   **Frontend**: Next.js (App Router), TypeScript, Tailwind CSS, Shadcn UI.
-   **Backend**: Node.js, Express, TypeScript.
-   **Databases**: PostgreSQL (Relational Data), Redis (Caching/Sessions).
-   **Messaging**: Apache Kafka.
-   **Security**: JWT Authentication, BCrypt Password Hashing.
-   **Orchestration**: `concurrently` for local development.

---

## 📦 Service Breakdown

### 1. Auth Service (`/services/auth`)
Handles everything related to user identity and security.
-   **Endpoints**: Registration, Login, Forgot/Reset Password.
-   **Roles**: Jobseeker and Recruiter.
-   **Tech**: PostgreSQL, Redis (for reset tokens), JWT.
-   **Kafka**: Publishes `send-mail` events for password resets.

### 2. Job Service (`/services/job`)
The core service for job-related operations.
-   **Companies**: Recruiters can create and manage their company profiles.
-   **Jobs**: CRUD operations for job postings with filters for job type, work location, salary, etc.
-   **Applications**: Manages the lifecycle of a job application (Submitted -> Rejected/Hired).
-   **Kafka**: Notifies applicants via the Utils service when their application status changes.

### 3. User Service (`/services/user`)
Focused on user profiles and specialized data.
-   **Skills**: Manages a global list of skills and user-specific skill mappings.
-   **Profile**: Fetches and updates user-specific details.

### 4. Utils Service (`/services/utils`)
A utility service designed to handle shared tasks.
-   **Upload**: Acts as a gateway for uploading files (resumes, logos) to cloud storage.
-   **Mail Consumer**: Listens to Kafka topics (like `send-mail`) and dispatches actual emails.

---

## 📂 Project Structure

```text
JOB-PORTAL/
├── frontend/             # Next.js Application
├── services/
│   ├── auth/             # Authentication Service
│   ├── job/              # Job & Company Management Service
│   ├── user/             # User Profile Service
│   └── utils/            # Shared Utilities (Mail, Upload)
├── package.json          # Root configuration to run all services
└── README.md             # You are here!
```

---

## 🛠️ Getting Started

### Prerequisites
-   Node.js (v18+)
-   PostgreSQL
-   Redis
-   Kafka

### Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/your-username/job-portal.git
    cd job-portal
    ```

2.  **Install dependencies**:
    Install dependencies for the root and all sub-services:
    ```bash
    npm install
    # You might need to run npm install in each service directory as well
    cd services/auth && npm install
    cd ../job && npm install
    # ... and so on
    ```

3.  **Environment Variables**:
    Create `.env` files in each service directory (`auth`, `job`, `user`, `utils`) following their respective `.env.example` templates.

4.  **Run Locally**:
    From the root directory, run:
    ```bash
    npm run dev
    ```
    This will concurrently start all the backend services. To start the frontend:
    ```bash
    cd frontend
    npm run dev
    ```

---

## 🧪 API Design
The services follow RESTful principles. Most protected routes require a Bearer token in the `Authorization` header.

| Service | Endpoint | Method | Description |
| :--- | :--- | :--- | :--- |
| **Auth** | `/api/auth/register` | `POST` | User registration |
| **Auth** | `/api/auth/login` | `POST` | User login |
| **Job** | `/api/jobs/create-job` | `POST` | Post a new job (Recruiter only) |
| **Job** | `/api/jobs/all` | `GET` | Get all active jobs with filters |
| **Job** | `/api/jobs/apply/:jobId` | `POST` | Apply for a job (Jobseeker only) |

---

## 📝 Roadmap
- [ ] AI-driven resume matching.
- [ ] Real-time chat between recruiters and candidates.
- [ ] Dashboard analytics for recruiters.
- [ ] Subscription model for premium job postings.

---


