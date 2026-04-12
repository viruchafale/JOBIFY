
# JobiFy - AI-Powered Microservices Job Portal

JobiFy is a modern, scalable job portal built with a microservices architecture. It connects recruiters and job seekers through a robust backend and a high-performance frontend, leveraging event-driven communication and cloud-native technologies.

---

## 🚀 Key Features

- **Microservices Architecture**: Each core domain (auth, jobs, users, utilities) is a separate service for scalability and maintainability.
- **Role-Based Access**: Distinct flows for Recruiters (post/manage jobs, companies, applications) and Jobseekers (search/apply jobs, manage profiles).
- **Event-Driven (Kafka)**: Asynchronous events for notifications, emails, and background tasks.
- **Redis Caching**: Fast access for sessions and short-lived tokens (e.g., password resets).
- **Full-Text Search**: Advanced job search and filtering.
- **Cloud File Uploads**: Secure resume/logo uploads via utility service.
- **Modern UI/UX**: Next.js, Tailwind CSS, and Shadcn UI for a responsive, premium experience.

---

## 🏗️ Project Structure & Folder Overview

The project is organized as a monorepo with the following main folders:

### `/frontend` — Next.js Application (User Interface)
- **Purpose**: The main web application for jobseekers and recruiters.
- **Key Structure:**
    - `src/app/` — Next.js App Router root. Contains all pages and routing logic.
        - `auth/` — Login, registration, password reset flows.
        - `jobs/` — Job listings, job details, and job application pages.
        - `account/` — Jobseeker profile, applied jobs, resume management.
        - `recruiter/` — Recruiter dashboard, job posting, application management, company management.
    - `src/components/` — Reusable UI components (Navbar, Hero, Resume Analyzer, etc.) and custom UI primitives (Button, Card, Dialog, etc.).
    - `src/context/` — React Context for global state (authentication, user data, etc.).
    - `src/lib/` — Utility functions for the frontend.
    - `public/` — Static assets (images, icons, etc.).

### `/services` — Microservices Backend Cluster
Each subfolder is an independent Node.js/Express service:

- **`/auth`** — Authentication & Authorization Service
    - Handles user registration, login, password reset, and role management (jobseeker/recruiter).
    - Publishes Kafka events for actions like password reset emails.
    - Uses PostgreSQL for user data and Redis for token storage.
    - Key folders:
        - `src/controllers/` — Business logic for authentication.
        - `src/routes/` — Express routes for auth endpoints.
        - `src/middleware/` — JWT verification, file upload, and security middleware.
        - `src/utils/` — Helper functions (DB connection, error handling, etc.).

- **`/job`** — Job & Company Management Service
    - CRUD operations for jobs and companies.
    - Manages job applications and their lifecycle (submitted, rejected, hired).
    - Notifies users via Kafka events on application status changes.
    - Key folders:
        - `src/controller/` — Logic for jobs, companies, and applications.
        - `src/routes/` — Endpoints for job and company operations.
        - `src/middleware/` — Auth and validation middleware.
        - `src/utils/` — Shared utilities (DB, error handling, etc.).

- **`/user`** — User Profile & Skills Service
    - Manages user profiles, resumes, display pictures, and skillsets.
    - Provides endpoints for updating and fetching user-specific data.
    - Key folders:
        - `src/controller/` — Profile and skill management logic.
        - `src/routes/` — User-related API endpoints.
        - `src/middleware/` — Auth and file upload middleware.
        - `src/utils/` — Utilities for DB, error handling, etc.

- **`/utils`** — Utility & Background Task Service
    - Handles file uploads (resumes, company logos) to cloud storage (e.g., Cloudinary/S3).
    - Consumes Kafka events for sending emails (e.g., password reset, application status updates).
    - Key folders:
        - `src/consumer.ts` — Kafka consumer for email events.
        - `src/routes.ts` — Express routes for utility endpoints.
        - `src/utils/` — Helper functions for cloud integration, error handling, etc.

---

## 🛠️ Tech Stack

- **Frontend**: Next.js (App Router), TypeScript, Tailwind CSS, Shadcn UI
- **Backend**: Node.js, Express, TypeScript
- **Databases**: PostgreSQL (main data), Redis (cache/sessions)
- **Messaging**: Apache Kafka (event-driven communication)
- **Security**: JWT, BCrypt
- **Dev Tools**: `concurrently` for local orchestration

---

## 📦 Example Directory Tree

```text
JOB-PORTAL/
├── frontend/             # Next.js Application (UI)
│   ├── src/app/          # Pages, layouts, routing
│   ├── src/components/   # UI components
│   ├── src/context/      # React Context
│   ├── src/lib/          # Frontend utilities
│   └── public/           # Static assets
├── services/
│   ├── auth/             # Auth microservice
│   ├── job/              # Job & company microservice
│   ├── user/             # User profile microservice
│   └── utils/            # Utility/background microservice
├── package.json          # Monorepo root config
└── README.md             # Project documentation
```

---

## ⚙️ How Each Folder Works

- **frontend/**: The main web app. Handles all user interactions, authentication, job search, applications, and recruiter dashboards. Communicates with backend services via REST APIs.
- **services/auth/**: Manages user authentication, registration, password resets, and role-based access. Publishes events for email notifications.
- **services/job/**: Handles CRUD for jobs and companies, manages job applications, and notifies users of status changes.
- **services/user/**: Manages user profiles, resumes, and skills. Allows users to update their information and view profiles.
- **services/utils/**: Handles file uploads to the cloud and sends emails by consuming Kafka events.
- **utils/**: Shared utility code for background tasks, Kafka consumers, and cloud integrations.

---

## 🧑‍💻 Getting Started

### Prerequisites

- Node.js (v18+)
- PostgreSQL
- Redis
- Kafka

### Installation

1. **Clone the repository**
     ```bash
     git clone https://github.com/your-username/job-portal.git
     cd job-portal
     ```
2. **Install dependencies**
     ```bash
     npm install
     # Then for each service:
     cd services/auth && npm install
     cd ../job && npm install
     cd ../user && npm install
     cd ../utils && npm install
     cd ../../frontend && npm install
     ```
3. **Environment Variables**
     - Create `.env` files in each service directory (`auth`, `job`, `user`, `utils`) using their `.env.example` as a template.
4. **Run Locally**
     - From the root directory:
         ```bash
         npm run dev
         ```
     - To start the frontend:
         ```bash
         cd frontend
         npm run dev
         ```

---

## 📚 API Overview (Sample)

| Service   | Endpoint                  | Method | Description                        |
|-----------|---------------------------|--------|------------------------------------|
| Auth      | `/api/auth/register`      | POST   | User registration                  |
| Auth      | `/api/auth/login`         | POST   | User login                         |
| Job       | `/api/job/create-job`     | POST   | Post a new job (Recruiter only)    |
| Job       | `/api/job/all`            | GET    | Get all active jobs with filters   |
| Job       | `/api/job/apply/:jobId`   | POST   | Apply for a job (Jobseeker only)   |

---

## 📝 Roadmap

- [ ] AI-driven resume matching
- [ ] Real-time chat between recruiters and candidates
- [ ] Dashboard analytics for recruiters
- [ ] Subscription model for premium job postings

---

## 🤝 Contributing

Contributions are welcome! Please open issues or submit pull requests for improvements, bug fixes, or new features.

---

## 📄 License

This project is licensed under the MIT License.

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
├── frontend/             # Next.js Application (User Interface)
│   ├── src/
│   │   ├── app/          # Next.js App Router root (Pages, Layouts, Routing)
│   │   │   ├── auth/     # Login and Registration pages
│   │   │   ├── jobs/     # Job listings & Job details pages
│   │   │   ├── account/  # Jobseeker profile, applied jobs, resume updates
│   │   │   └── recruiter/# Recruiter dashboard, post jobs, manage applications & companies
│   │   ├── components/   # Reusable UI components (Hero, Navbar, Resume Analyzer, custom UI components)
│   │   └── context/      # Global state management using React Context (AppContext)
├── services/             # Microservices backend cluster
│   ├── auth/             # Authentication & Authorization Service 
│   │   ├── src/controllers/ # Logic for login, signup, forgot password
│   │   ├── src/models/      # Database schemas for User credentials
│   │   ├── src/routes/      # Express routes for authentication endpoints
│   │   └── src/middleware/  # Security interceptors and JWT verification
│   ├── job/              # Core Jobs & Companies Management Service
│   │   ├── src/controller/  # Job posting, fetching, company profile creation
│   │   ├── src/routes/      # Endpoints for job and company CRUD operations
│   │   └── src/middleware/  # Request validation and auth middlewre
│   ├── user/             # User Profiles & Skills Service
│   │   ├── src/controller/  # Updates for profiles, resumes, DP, and skills definitions
│   │   └── src/routes/      # Endpoints for public and private user details
│   └── utils/            # Utilities & background tasks
│       ├── src/email/       # Kafka consumers for sending email notifications
│       └── src/upload/      # Cloud service integrations (Cloudinary/S3) for file hosting
├── package.json          # Monorepo/Root configuration to easily run all services
└── README.md             # Project documentation (You are here!)
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


