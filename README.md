# JobiFy - AI-Powered Microservices Job Portal

JobiFy is a scalable, cloud-native job portal engineered to connect top talent with industry-leading companies. Built completely from the ground up utilizing a **true microservices architecture**, the platform leverages event-driven communication, distributed caching mechanisms, and a high-performance frontend to deliver an enterprise-grade experience for both jobseekers and recruiters.

---

## ✨ Key Technical Achievements

- **Microservices Cluster**: Designed and deployed four highly decoupled core services (`Auth`, `Jobs`, `Users`, and `Utils`), ensuring independent scalability and isolated fault tolerance.
- **Event-Driven Workflows**: Implemented **Apache Kafka** to handle asynchronous tasks, such as real-time applicant status notifications and transactional email dispatch.
- **High-Performance Infrastructure**: Integrated **PostgreSQL** for strict relational data integrity and **Redis** for lightning-fast token validation and session caching.
- **Secure Role-Based Access Control (RBAC)**: Developed distinct logical flows restricting data mutation and access strictly based on `Jobseeker` and `Recruiter` roles using stateless JWT strategies.
- **Cloud Integration**: Centralized, secure file handling for resumes, profile pictures, and company logos using cloud storage pipelines.
- **Modern UI/UX**: Built a premium, fully responsive, and highly dynamic frontend utilizing **Next.js** (App Router), **Tailwind CSS**, and **Shadcn UI**.

---

## 🛠️ Technology Stack

| Category         | Technologies Used                                                                     |
| ---------------- | ------------------------------------------------------------------------------------- |
| **Frontend**     | Next.js, React, TypeScript, Tailwind CSS, Shadcn UI                                   |
| **Backend**      | Node.js, Express.js, TypeScript                                                       |
| **Databases**    | PostgreSQL (Primary Data), Redis (Caching)                                            |
| **Architecture** | Microservices, Event-Driven Design, Apache Kafka (Message Broker)                     |
| **Security**     | JWT (JSON Web Tokens), Bcrypt                                                         |
| **DevOps**       | Docker, AWS EC2                                                                       |

---

## 🏗️ System Architecture & Project Structure

The project is structured as a monorepo containing the decoupled frontend and isolated microservices.

```text
JOB-PORTAL/
├── frontend/             # Next.js Application (User Interface)
│   ├── src/app/          # Next.js App Router root (Pages, Layouts, Routing)
│   └── src/components/   # Reusable UI components & Resume Analyzer
├── services/             # Microservices Backend Cluster
│   ├── auth/             # Authentication & Authorization Service 
│   ├── job/              # Core Jobs & Companies Management Service
│   ├── user/             # User Profiles & Global Skills Service
│   └── utils/            # Shared Utilities (Cloud uploads, Kafka email consumers)
└── docker-compose.yml    # Development Orchestration
```

---

## 🚀 Getting Started Local Development

### Prerequisites
- Node.js (v18+)
- PostgreSQL
- Redis
- Apache Kafka

### Setup Instructions

1. **Clone the repository**
   ```bash
   git clone https://github.com/viruchafale/JOBIFY.git
   cd JOBIFY
   ```

2. **Initialize Environment Variables**
   Create a `.env` file in each of the core service directories (`auth`, `job`, `user`, `utils`) using their respective `.env.example` templates. Configure your DB and Kafka connections.

3. **Install Dependencies & Start**
   ```bash
   npm install        
   npm run dev        # Starts all 4 backend microservices concurrently
   ```

4. **Start the Frontend Client**
   ```bash
   cd frontend
   npm install
   npm run build
   npm start
   ```

---

## 🧪 API Design Overview 

The backend services follow strict RESTful principles. All protected endpoints strictly validate Bearer tokens and enforce RBAC rules.

| Service | Endpoint | Method | Purpose |
| :--- | :--- | :--- | :--- |
| **Auth** | `/api/auth/register` | `POST` | User registration and role allocation |
| **Auth** | `/api/auth/login` | `POST` | Primary authentication gateway |
| **Job** | `/api/jobs/create-job` | `POST` | Secure job publishing `(Recruiters Only)` |
| **Job** | `/api/jobs/all` | `GET` | Retrieve highly filtered active job listings |
| **Job** | `/api/jobs/apply/:jobId` | `POST` | Application submission `(Jobseekers Only)`|

---

## 📝 Roadmap

- [ ] Build standalone ML microservice for AI-driven resume-to-job matching.
- [ ] Implement WebSockets for real-time chat between recruiters and candidates.
- [ ] Integrate graphical dashboard analytics for recruiter tracking.

---

## 📄 License
This project is licensed under the MIT License.
