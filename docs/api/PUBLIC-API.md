# Jobify 2.0 — Public API & Gateway Specification

## 1. Overview & Architecture

Jobify 2.0 unifies all client communication through a single, thin, observable API Gateway / BFF (Backend-For-Frontend) running on port `5000`.

Direct browser access to backend microservices (`auth:5001`, `user:5002`, `job:5003`, `utils:5004`) is replaced with reverse proxy routing through the Gateway.

```
+----------------------------------------------------------------+
|                        Frontend Client                         |
|                    (Next.js App / Port 3000)                   |
+-------------------------------+--------------------------------+
                                |
                   HTTP /api/*  | (Cookies + Request-Id)
                                v
+----------------------------------------------------------------+
|                      API Gateway / BFF                         |
|                         (Port 5000)                            |
|       - Request ID Injection (x-request-id)                    |
|       - Centralized CORS & Security Headers (Helmet)           |
|       - Global Error & Timeout Envelope                        |
|       - Reverse Proxy Routing (http-proxy-middleware)          |
+-------+---------------+----------------+---------------+-------+
        |               |                |               |
        v               v                v               v
  +-----------+   +-----------+    +-----------+   +-----------+
  |   Auth    |   |   User    |    |    Job    |   |   Utils   |
  |  Service  |   |  Service  |    |  Service  |   |  Service  |
  |  (:5001)  |   |  (:5002)  |    |  (:5003)  |   |  (:5004)  |
  +-----------+   +-----------+    +-----------+   +-----------+
```

---

## 2. Standard Request & Response Headers

### Request Headers
- `x-request-id`: Optional client-provided request ID. If omitted, the Gateway automatically generates a UUIDv4 and propagates it downstream to all services and logs.
- `Cookie`: Contains `token` (HttpOnly session cookie) for authenticated requests.

### Response Headers
- `x-request-id`: Returned on every response for distributed tracing and log correlation.

---

## 3. Standard Error Envelope

All error responses from Gateway and backend microservices conform to the standardized error schema:

```json
{
  "message": "Error description message",
  "code": "ERROR_CODE_STRING",
  "requestId": "c1f76856-7ee6-4e56-8349-4b6ad3bb5db3",
  "timestamp": "2026-09-16T15:30:00.000Z"
}
```

### Common Error Codes:
- `UNAUTHORIZED` (401): Session expired or missing authentication token.
- `FORBIDDEN` (403): Role or resource ownership mismatch.
- `NOT_FOUND` (404): Resource or route not found.
- `BAD_REQUEST` (400): Validation error or missing required fields.
- `TOO_MANY_REQUESTS` (429): Rate limit exceeded.
- `GATEWAY_ERROR` / `BAD_GATEWAY` (502): Downstream microservice unreachable.
- `INTERNAL_SERVER_ERROR` (500): Unhandled exception.

---

## 4. Health & Observability Endpoints

| Endpoint | Method | Target | Description |
| :--- | :--- | :--- | :--- |
| `/health` | `GET` | All services | Liveness check returns `{ status: "ok", service: "<name>", timestamp }` |
| `/ready` | `GET` | All services | Readiness check verifies connectivity to PostgreSQL & Redis |

---

## 5. Public Gateway Routes

### Auth Service (`/api/auth/*`)
- `POST /api/auth/register` — Register a jobseeker or recruiter.
- `POST /api/auth/login` — Authenticate and issue secure HttpOnly session cookie.
- `POST /api/auth/logout` — Revoke Redis session and clear cookie.
- `POST /api/auth/forgot` — Request password reset email.
- `POST /api/auth/reset/:token` — Reset password using verified token.

### User Service (`/api/user/*`)
- `GET /api/user/me` — Retrieve current authenticated user profile.
- `GET /api/user/:id` — Retrieve public profile by user ID.
- `PUT /api/user/update/profile` — Update name, phone, bio, etc.
- `PUT /api/user/update/pic` — Update profile avatar (multipart/form-data).
- `PUT /api/user/update/resume` — Upload resume document (multipart/form-data).
- `POST /api/user/skill/add` — Add skill.
- `DELETE /api/user/skill/delete` — Delete skill.
- `GET /api/user/application/all` — Retrieve job application history for current user.

### Job Service (`/api/job/*`)
- `GET /api/job/all` — List active jobs with optional title/location query params.
- `GET /api/job/:jobId` — Get job details and company profile.
- `POST /api/job/new` — Create new job posting (Recruiter only).
- `PUT /api/job/update/:jobId` — Edit job posting (Owner recruiter only).
- `POST /api/job/apply/:jobId` — Submit application for job (Applicant only).
- `GET /api/job/application/:jobId` — View applicants for job (Owner recruiter only).
- `PUT /api/job/application/update/:applicationId` — Update status to `Submitted`, `Rejected`, or `Hired` (Owner recruiter only).
- `GET /api/job/company/all` — List recruiter's registered companies.
- `GET /api/job/company/:companyId` — View company details and jobs.
- `POST /api/job/company/new` — Create company (Recruiter only).
- `DELETE /api/job/company/:companyId` — Delete company (Owner recruiter only).

### Utils Service (`/api/utils/*`)
- `POST /api/utils/career` — AI Career guide analysis for skills (Authenticated).
- `POST /api/utils/resume-analyzer` — AI ATS resume scoring (Authenticated).
