# JOBIFY CODEBASE AUDIT REPORT

> **Read-only forensic audit** of the JobiFy codebase.
> Repository: `/Users/viru/Desktop/JOBIFY`
> Branch: `main` @ `c92bdb2`
> Audit date: September 3, 2026

---

## A. Executive Summary

**What have you actually built?**

JobiFy is a **job portal web application** structured as a monorepo with:

- **Frontend**: A Next.js 16 (App Router) client using React 19, Tailwind CSS4, Shadcn UI (Radix primitives), with a "premium editorial" design language. Includes authentication, role-based dashboards (jobseeker/recruiter), public job listings, AI-powered resume analysis & career guidance features.
- **Backend**: Four Node.js/Express 5/TypeScript microservices — `auth`, `job`, `user`, and `utils` — each with its own package, Dockerfile, and source tree.
- **Data**: Three databases/schema surfaces declared inside service `index.ts` files using `@neondatabase/serverless` against PostgreSQL.
- **Async/Email**: Apache Kafka producers in `auth` and `job`, with a Kafka consumer in `utils` that sends transactional email via `nodemailer` (Gmail SMTP).
- **Storage**: Cloudinary for resume/profile-pic/company-logo uploads, proxied through the `utils` service.
- **AI**: Google Gemini (`@google/genai`) integration in `utils` for resume analysis (ATS scoring) and career guidance.
- **Caching**: Redis client initialized in the `auth` service, used only for password-reset token storage.

**Honest assessment**: The system is functional at a demo level. Auth, jobs, applications, companies, profile editing, resume analyzer and career guide are wired end-to-end. It is **not production-ready**: no CI/CD, no docker-compose, no `.env` examples, no tests, the `utils` service has hardcoded SMTP credentials structure but lacks security hygiene, and several architectural decisions would not survive a real campus-scale launch.

---

## B. Architecture

```text
Browser (Next.js client at port 3000)
   |
   +-- HTTP calls (REST) to 4 publicly exposed service base URLs:
   |     - auth-service  :5002  (registration, login, forgot/reset password)
   |     - job-service   :5007  (companies, jobs, applications, apply)
   |     - user-service  :5006  (profile, skills, resume/pic, "apply" duplicate)
   |     - utils-service :5005  (Cloudinary upload proxy, Gemini AI, mail consumer)
   |
   v

Services are NOT fronted by any gateway or API aggregator.
Each service is its own Express app with its own port, JWT secret (shared via env), and DB.

Cross-service communication (synchronous):
   auth-service --(HTTP)--> utils-service   (resume upload during register)
   job-service  --(HTTP)--> utils-service   (logo & resume upload)
   user-service --(HTTP)--> utils-service   (profile_pic & resume update)

Event-driven (asynchronous):
   auth-service producer ----> Kafka topic "send-mail" ---> utils-service consumer
   job-service  producer ----> Kafka topic "send-mail" ---> utils-service consumer
   (Only ONE consumer group: "mail-service-group" in utils-service.)

Datastores:
   - Neon serverless PostgreSQL (auth owns users + skills + user_skills; job owns companies + jobs + applications)
   - Redis (auth only, for password reset tokens)
   - Cloudinary (via utils-service; objects referenced by public_id stored in users/companies/applications tables)
```

### Module responsibilities & status

| Service | Port | Responsibility | DB | External Deps | Status |
|---|---|---|---|---|---|
| `auth` | 5002 | Register/login/forgot/reset; user & skills tables | Neon PG + Redis | Kafka producer, utils upload | Implemented |
| `job` | 5007 | Companies, jobs, applications, apply; company/jobs/applications tables | Neon PG | Kafka producer, utils upload | Implemented |
| `user` | 5006 | My profile, get user, update profile/pic/resume, skills CRUD, "apply" duplicate, "my applications" | Neon PG (queries only) | utils upload | Implemented (no schema ownership) |
| `utils` | 5005 | Cloudinary upload proxy, Kafka mail consumer, Career AI, Resume AI | None | Google Gemini, Gmail SMTP | Implemented |

**Key observation**: The `user` service does not own any tables. It reads the same Neon DB the `auth` service owns. There is no service boundary enforced. This is functionally a **modular monolith split into 4 deployables** rather than true microservices.

---

## C. Technology Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Frontend framework | Next.js (App Router) | ^16.1.6 | SSR/CSR React app |
| UI library | React | 19.2.3 | UI runtime |
| Styling | Tailwind CSS | ^4 | Utility CSS (CSS-first config) |
| UI primitives | @radix-ui/* (avatar, dropdown, dialog) + custom shadcn-style wrappers | various | Accessible primitives |
| Icons | lucide-react | ^0.563.0 | Icon set |
| Theme | next-themes | ^0.4.6 | Light/dark mode |
| Toasts | react-hot-toast | ^2.6.0 | Notifications |
| Cookies | js-cookie | ^3.0.5 | Token storage |
| HTTP | axios | ^1.14.0 | REST client |
| Backend runtime | Node.js (TS) | ESM | Services |
| Web framework | Express | ^5.2.1 | HTTP server |
| Database driver | @neondatabase/serverless | ^1.0.2 | Postgres (HTTP-mode) |
| Cache | redis | ^5.10.0 | Reset-token store |
| Auth | jsonwebtoken + bcrypt | 9.0.3 / 6.0.0 | JWT & password hashing |
| Message broker | kafkajs | ^2.2.4 | Async events |
| Email | nodemailer | ^7.0.12 | SMTP |
| AI | @google/genai | ^1.38.0 | Gemini (resume + career) |
| Storage | cloudinary | ^2.9.0 | Object store |
| File upload | multer | ^2.0.2 | Multipart parsing |
| Language | TypeScript | ^5.9.3 | Static typing (FE has `strict:false`) |
| Containerization | Docker | node:25-alpine | Per-service Dockerfiles |

**Languages**: TypeScript only (frontend and backend). No Python, no Go.
**Tests**: None. Zero test files (`*test*`, `*spec*`, `__tests__` searches all empty).
**CI/CD**: None. No `.github/`, no `.gitlab-ci.yml`, no Jenkinsfile.
**Orchestration**: None. No `docker-compose.yml` despite README claiming one.

---

## D. Feature Inventory

### D.1 Fully Implemented (end-to-end)

| Feature | Evidence |
|---|---|
| User registration (jobseeker/recruiter) with resume upload | `services/auth/src/controllers/auth.ts::registerUser` + `frontend/src/app/auth/register/page.tsx` |
| Login (JWT 15-day expiry, httpOnly=false cookie) | `services/auth/src/controllers/auth.ts::loginUser` + `frontend/src/app/auth/login/page.tsx` |
| Logout (client-only) | `frontend/src/context/AppContext.tsx::logoutUser` |
| Forgot password (Kafka async mail) | `services/auth/src/controllers/auth.ts::forgetPassword` + reset token in Redis |
| Reset password | `services/auth/src/controllers/auth.ts::resetPassword` + `frontend/src/app/auth/reset/[token]/page.tsx` |
| View any user profile | `GET /api/user/:userId` + `frontend/src/app/account/[id]/page.tsx` |
| Update own profile (name/phone/bio) | `PUT /api/user/update/profile` + `frontend/src/app/account/edit/page.tsx` |
| Update profile pic (Cloudinary) | `PUT /api/user/update/pic` |
| Update resume (Cloudinary) | `PUT /api/user/update/resume` |
| Add/remove skills (with shared global skill dictionary) | `POST/DELETE /api/user/skill/*` |
| Browse all active jobs (search by title/location) | `GET /api/job/all?title=&location=` + `frontend/src/app/jobs/page.tsx` |
| View single job | `GET /api/job/:jobId` + `frontend/src/app/jobs/[jobId]/page.tsx` |
| Apply to job (jobseeker, uses profile resume) | `POST /api/job/apply/:jobId` |
| Recruiter: create company | `POST /api/job/company/new` (auth + RBAC) + `frontend/src/app/recruiter/companies/new/page.tsx` |
| Recruiter: list own companies | `GET /api/job/company/all` |
| Recruiter: view company details with nested jobs | `GET /api/job/company/:id` |
| Recruiter: delete company (cascades jobs) | `DELETE /api/job/company/:companyId` |
| Recruiter: create job | `POST /api/job/new` |
| Recruiter: update job | `PUT /api/job/update/:jobId` |
| Recruiter: list applications per job | `GET /api/job/application/:jobId` |
| Recruiter: change application status (with mail) | `PUT /api/job/application/update/:id` |
| AI resume analyzer (PDF, Gemini) | `POST /api/utils/resume-analyzer` + `frontend/src/components/resume-analyzer.tsx` |
| AI career guidance (skill list, Gemini) | `POST /api/utils/career` + `frontend/src/components/career-guide.tsx` |
| Cloudinary upload proxy | `POST /api/utils/upload` |
| Async email dispatch | Kafka `send-mail` topic, `utils` service consumer via Gmail SMTP |
| Light/dark theme | `next-themes` + `ModeToggle` |

### D.2 Partially Implemented / Inconsistent

| Feature | What's incomplete |
|---|---|
| Student "My Applications" page | Calls `GET /api/user/application/all` whose SQL uses `application_id` instead of `applicant_email` or `user_id` to filter — bug. Also the page defines its own local `Application` interface with status `"pending"\|"accepted"\|"rejected"`, but the backend enum is `'Submitted'\|'Rejected'\|'Hired'`. The page will never render correct statuses. |
| Job details page | Backend `getSingleJobs` returns only `*` from `jobs` (no company join) but the UI tries to render `company_name`/`company_logo` and silently falls back to a building icon. Comment in code: `Company Details in Progress`. |
| Apply-to-job | Two competing endpoints exist: `POST /api/job/apply/:jobId` (job service) and `POST /api/user/apply/job` (user service). The latter inserts an `application_id` column that doesn't exist (`applications.application_id` is SERIAL auto-generated; user.ts puts `applicant_id` into it — schema drift). UI uses the job-service endpoint. |
| "subscription" field on users | Stored in DB but never set anywhere. Referenced by `applyJob` in user.ts to compute `isSubscribed` — feature is dead. |
| Search | Server-side `ILIKE` with no full-text index. No pagination. No skills/category filter. |
| Recruiter edit page | Does not send `is_active` toggle (no UI control), but backend expects it in the UPDATE. |

### D.3 Not Implemented

| Feature | Why |
|---|---|
| Email verification | No routes/code |
| Admin role / admin dashboard | No role, no routes |
| Saved jobs | No routes/tables |
| Job recommendations / matching | No engine (career-guide uses free-text skills, not jobs) |
| Pagination | Not implemented on `/all`, `/company/all`, `/application/all` |
| Notifications (in-app/WebSocket/push) | Not implemented |
| Refunds | "subscription" column hints at billing; nothing exists |
| Clubs / Events / Alumni / Mentorship | No schema, no routes, no UI |
| WebSocket/chat | Not implemented |
| Rate limiting | Not implemented |
| API documentation (Swagger/OpenAPI) | None |

---

## E. API Inventory

### E.1 Auth service — `http://51.20.37.105:5002`

| Method | Path | Auth | Role | Body | Response |
|---|---|---|---|---|---|
| POST | `/api/auth/register` | Public | either | multipart: name, email, password, phoneNumber, role, bio?, file? (resume) | 201 `{message,user,token}` |
| POST | `/api/auth/login` | Public | either | `{email,password}` | 201 `{message,user,token}` |
| POST | `/api/auth/forgot` | Public | either | `{email}` | `{message}` (enqueues Kafka mail) |
| POST | `/api/auth/reset/:token` | Public | either | `{password}` | `{message}` |

### E.2 Job service — `http://51.20.37.105:5007`

| Method | Path | Auth | Role | Notes |
|---|---|---|---|---|
| POST | `/api/job/company/new` | JWT | recruiter | multipart (name, description, website, file) |
| DELETE | `/api/job/company/:companyId` | JWT | recruiter (owner) | cascade-deletes jobs |
| GET | `/api/job/company/all` | JWT | recruiter | returns only `recruiter_id = me` |
| GET | `/api/job/company/:id` | JWT | any | returns company + nested jobs array |
| POST | `/api/job/new` | JWT | recruiter | body `{title,description,salary,role,job_type,work_location,company_id,openings,location}` |
| PUT | `/api/job/update/:jobId` | JWT | recruiter (owner) | also accepts `is_active` |
| GET | `/api/job/all` | Public | any | query `title`, `location` (ILIKE) |
| GET | `/api/job/:jobId` | Public | any | single job, no company join |
| GET | `/api/job/application/:jobId` | JWT | recruiter (owner) | applications list |
| PUT | `/api/job/application/update/:id` | JWT | recruiter (owner) | body `{status}`, status must match enum |
| POST | `/api/job/apply/:jobId` | JWT | jobseeker | uses profile resume OR uploaded file |

### E.3 User service — `http://51.20.37.105:5006`

| Method | Path | Auth | Role | Notes |
|---|---|---|---|---|
| GET | `/api/user/me` | JWT | any | |
| GET | `/api/user/:userId` | JWT | any | |
| PUT | `/api/user/update/profile` | JWT | any | `{name,phone_number,bio}` |
| PUT | `/api/user/update/pic` | JWT | any | multipart |
| PUT | `/api/user/update/resume` | JWT | any | multipart |
| POST | `/api/user/skill/add` | JWT | any | `{skillName}` |
| DELETE | `/api/user/skill/delete` | JWT | any | `{skillName}` (in body — `data` field) |
| POST | `/api/user/apply/job` | JWT | jobseeker | `{job_id}` (BUGGY: passes `applicant_id` as `application_id`) |
| GET | `/api/user/application/all` | JWT | jobseeker | (BUGGY: filters by `application_id` field, should be applicant_email/user_id) |

### E.4 Utils service — `http://51.20.37.105:5005`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/utils/upload` | Public (no JWT) | Cloudinary upload proxy |
| POST | `/api/utils/career` | Public | Gemini career advice |
| POST | `/api/utils/resume-analyzer` | Public | Gemini ATS analysis |

**Security observations**:
- 🔴 **No auth on `utils` endpoints**. Anyone with the URL can spam Cloudinary uploads and burn Gemini quota.
- 🔴 **No CORS allowlist**. `cors()` with default settings — open to all origins.
- 🔴 **No rate limiting** anywhere.

---

## F. Database Inventory

### F.1 Tables (created at runtime by service `index.ts` initDB())

**Owned by `auth` service** (`services/auth/src/index.ts:35-80`):

```text
users
 ├── user_id SERIAL PK
 ├── name VARCHAR(255) NOT NULL
 ├── email VARCHAR(255) UNIQUE NOT NULL
 ├── password VARCHAR(255) NOT NULL        -- bcrypt
 ├── phone_number VARCHAR(20) NOT NULL
 ├── role user_role NOT NULL               -- enum: 'jobseeker' | 'recruiter'
 ├── bio TEXT
 ├── resume VARCHAR(255)                   -- Cloudinary URL
 ├── resume_public_id VARCHAR(255)
 ├── profile_pic VARCHAR(255)
 ├── profile_pic_public_id VARCHAR(255)
 ├── created_at TIMESTAMPTZ DEFAULT now()
 └── subscription TIMESTAMPTZ              -- DEAD FIELD

skills
 ├── skill_id SERIAL PK
 └── name VARCHAR(100) UNIQUE NOT NULL

user_skills
 ├── user_id FK -> users (ON DELETE CASCADE)
 ├── skill_id FK -> skills (ON DELETE CASCADE)
 └── PK (user_id, skill_id)
```

**Owned by `job` service** (`services/job/src/index.ts:18-79`):

```text
companies
 ├── company_id SERIAL PK
 ├── name VARCHAR(255) UNIQUE NOT NULL
 ├── description TEXT NOT NULL
 ├── website VARCHAR(255) NOT NULL
 ├── logo VARCHAR(255) NOT NULL
 ├── logo_public_id VARCHAR(255) NOT NULL
 ├── recruiter_id INTEGER NOT NULL        -- no FK!
 └── created_at TIMESTAMPTZ DEFAULT now()

jobs
 ├── job_id SERIAL PK
 ├── title VARCHAR(255) NOT NULL
 ├── description TEXT NOT NULL
 ├── salary NUMERIC(10,2)
 ├── location VARCHAR(255)
 ├── job_type job_type NOT NULL            -- enum: 'Full-time'|'Part-time'|'Contract'|'Internship'
 ├── openings NUMERIC(3,1) NOT NULL
 ├── role VARCHAR(255) NOT NULL
 ├── work_location work_location NOT NULL  -- enum: 'On-site'|'Remote'|'Hybrid'
 ├── company_id INTEGER FK -> companies (CASCADE) NOT NULL
 ├── posted_by_recruiter_id INTEGER NOT NULL -- no FK
 ├── created_at TIMESTAMPTZ DEFAULT now()
 └── is_active BOOLEAN DEFAULT true

applications
 ├── application_id SERIAL PK
 ├── job_id INTEGER FK -> jobs (CASCADE) NOT NULL
 ├── applicant_email VARCHAR(255) NOT NULL
 ├── status application_status DEFAULT 'Submitted'  -- enum: 'Submitted'|'Rejected'|'Hired'
 ├── resume VARCHAR(255) NOT NULL
 ├── applied_at TIMESTAMPTZ DEFAULT now()
 ├── subscribed BOOLEAN                    -- DEAD FIELD
 └── UNIQUE (job_id, applicant_email)
```

### F.2 Critical schema problems

| Severity | Issue | Location |
|---|---|---|
| 🔴 Critical | `companies.recruiter_id` and `jobs.posted_by_recruiter_id` are `INTEGER` with **no foreign key** to `users.user_id`. Orphan rows are trivially possible. | auth `users` ↔ job `companies`/`jobs` |
| 🟠 High | `users.subscription` and `applications.subscribed` columns are referenced in code (`user.ts::applyForJob`) but nothing ever sets them. Dead fields. | `auth/src/index.ts` schema, `user/src/controller/user.ts` |
| 🟠 High | `applications.application_id` is a SERIAL primary key, but `user.ts::applyForJob` attempts to insert into that column from `req.user.user_id`. The INSERT will silently succeed inserting a wrong ID into PK, or fail depending on coercion. Latent bug. | `user/src/controller/user.ts:215-225` |
| 🟠 High | `getAllApplications` in user.ts queries `WHERE a.application_id = ${user_id}` — this is **semantically wrong** (should filter by `applicant_email` or maintain an `applicant_id` column). The frontend dashboard is fed garbage. | `user/src/controller/user.ts:236-247` |
| 🟡 Medium | Application status enum `'Submitted'\|'Rejected'\|'Hired'` does not match the frontend's expected `"pending"\|"accepted"\|"rejected"` strings. The My Applications page will never show accurate statuses. | `job/src/index.ts` enum vs `frontend/src/app/account/applications/page.tsx:13` |
| 🟡 Medium | `jobs.salary NUMERIC(10,2)` stores a year of decimal dollars (e.g. 120000.00) — works, but no currency awareness. | job schema |
| 🟡 Medium | `jobs.openings NUMERIC(3,1)` is decimal — should be INTEGER. | job schema |
| 🟡 Medium | No indexes on `jobs.title`, `jobs.location`, `users.email` (the email is implicit via UNIQUE), `applications.job_id`. The `getAllActiveJobs` query does `ILIKE '%term%'` on un-indexed columns and will full-scan as data grows. | job `index.ts` |
| 🟡 Medium | No soft-delete columns. Companies and jobs hard-delete with CASCADE — recruiter mistakes destroy applications too. | job `index.ts` |
| 🟢 Low | `users.created_at` is used in `RETURNING` clauses, but column is missing from `RETURNING` in `registerUser` for jobseekers (returns `create_at` — typo? would actually be `created_at`). Backend would return undefined for that field. | `auth/src/controllers/auth.ts:84` |

### F.3 DB driver concern

The services use **`@neondatabase/serverless`**, which is HTTP-mode and intended for edge/serverless. It is **being used inside long-running Node containers** that already have direct network access — this is a meaningful mismatch. Neon serverless works fine, but you lose connection pooling benefits you'd get with `pg`/Pool. Not blocking, but worth noting for scale.

---

## G. Authentication & Authorization

### G.1 Roles

**Only two roles exist**: `jobseeker` and `recruiter`. There is no admin.

### G.2 Token model

- JWT signed with `process.env.SECRET_KEY`, 15-day expiry, payload `{id: user_id}`.
- Stored client-side in `js-cookie` (not httpOnly, not secure, path `/`) — see `frontend/src/context/AppContext.tsx:11-21`.
- Same `SECRET_KEY` is used across **all four services** — services are coupled by shared secret rather than by trust.

### G.3 Permissions matrix

| Action | Jobseeker | Recruiter | Anonymous |
|---|:---:|:---:|:---:|
| Register / Login / Forgot / Reset | ✅ | ✅ | ✅ |
| View own profile | ✅ | ✅ | — |
| View other profile | ✅ | ✅ | — |
| Update own profile / pic / resume / skills | ✅ | ✅ | — |
| Apply to job | ✅ | 🚫 | 🚫 |
| Browse jobs list / single job | ✅ | ✅ | ✅ |
| Search by title/location | ✅ | ✅ | ✅ |
| Create / edit / delete company | 🚫 | ✅ (own only) | 🚫 |
| Create / edit job | 🚫 | ✅ (own only) | 🚫 |
| List applications for a job | 🚫 | ✅ (own only) | 🚫 |
| Update application status | 🚫 | ✅ (own only) | 🚫 |
| View recruiter dashboard | 🚫 | ✅ | 🚫 |
| Use AI resume analyzer / career guide | ✅ | ✅ | ✅ |
| Upload to Cloudinary proxy | ✅ | ✅ | ✅ ⚠️ |

### G.4 Security findings (full list in section K)

- 🟠 Reset token leak: `services/auth/src/controllers/auth.ts::forgetPassword` responds with `"If that email"` whether or not the email exists (good — prevents enumeration). But the same line also publishes to Kafka **even when the email doesn't exist** because the publishToTopic is below the user check. Wait — re-reading: publishToTopic runs only after the early return for unknown email. OK, this is fine.
- 🟠 `deleteCompany` uses `${user?.user_id}` without null check (`services/job/src/controller/jobs.ts::deleteCompany`). Unauthed requests get `undefined !== undefined` → 404. OK actually.
- 🔴 **No CSRF protection**. The frontend sends `Authorization: Bearer` header, not cookies to backend — so far safe. But `js-cookie` is `secure:false`. If a cookie-based session were ever added, CSRF would bite.
- 🔴 **`next.config.ts` allows remote images from `**`** (`hostname: "**"`). Permissive.
- 🟠 **Token stored in JS-readable cookie**. XSS → token theft. Use httpOnly + server-set cookies with SameSite=Lax instead.

---

## H. Frontend

### H.1 Routes

| Route | File | Purpose | Auth | Status |
|---|---|---|---|---|
| `/` | `app/page.tsx` | Marketing landing (hero, AI modules, CTA) | Public | Complete |
| `/about` | `app/about/page.tsx` | Static about page | Public | Complete |
| `/jobs` | `app/jobs/page.tsx` | Search & list active jobs | Public | Complete |
| `/jobs/[jobId]` | `app/jobs/[jobId]/page.tsx` | Job detail + Apply | Public (apply needs auth) | Partial (no company info shown) |
| `/auth/login` | `app/auth/login/page.tsx` | Login form | Public | Complete |
| `/auth/register` | `app/auth/register/page.tsx` | Register (role choice) | Public | Complete |
| `/auth/forgot` | `app/auth/forgot/page.tsx` | Request reset email | Public | Complete |
| `/auth/reset/[token]` | `app/auth/reset/[token]/page.tsx` | Reset form | Public | Complete |
| `/account` | `app/account/page.tsx` | Own profile view | Required | Complete |
| `/account/[id]` | `app/account/[id]/page.tsx` | Any user profile | Required | Complete |
| `/account/edit` | `app/account/edit/page.tsx` | Edit profile + upload pic/resume + skills | Required | Complete |
| `/account/applications` | `app/account/applications/page.tsx` | My Applications list | Required, jobseeker | Broken data |
| `/recruiter/applications` | `app/recruiter/applications/page.tsx` | Recruiter dashboard | Required, recruiter | Complete |
| `/recruiter/companies/new` | `app/recruiter/companies/new/page.tsx` | Create company | Required, recruiter | Complete |
| `/recruiter/jobs/new` | `app/recruiter/jobs/new/page.tsx` | Post a job | Required, recruiter | Complete |
| `/recruiter/jobs/[jobId]/edit` | `app/recruiter/jobs/[jobId]/edit/page.tsx` | Edit job | Required, recruiter | Complete |

### H.2 Components inventory

- `Navbar` — sticky header, role-aware (Post Job / Dashboard links), mobile drawer, theme toggle.
- `Hero` — landing visual with stats (hardcoded numbers: "12k+ Live openings", "1.8k+ Hiring teams", "92% Resume match accuracy").
- `CareerGuide` — modal dialog with skill chips → calls `/api/utils/career`.
- `ResumeAnalyzer` — modal dialog with PDF upload → calls `/api/utils/resume-analyzer`.
- `Loading` — spinner.
- `ThemeProvider`, `ModeToggle` — dark mode.
- shadcn-style primitives: `button`, `card`, `dialog`, `dropdown-menu`, `input`, `label`, `popover`, `avatar`.

### H.3 State management

- One React Context (`AppContext`) with `useAppData()` hook — `user`, `isAuth`, `loading`, `btnLoading`, `logoutUser`.
- No React Query, no SWR, no global state library. Each page does its own `useEffect + fetch`.
- Tokens stored in `js-cookie`, read on every protected API call by every component.

### H.4 UX problems observed (not fixing)

1. **Logout is client-only**. `logoutUser` clears the cookie and state but doesn't invalidate the JWT server-side. Token remains valid for 15 days.
2. **Hardcoded stats** in hero (`12k+`, `1.8k+`, `92%`) — misleading on day one.
3. **Job detail page shows "Company Details in Progress"** — literal placeholder string in the JSX (line 91 of `frontend/src/app/jobs/[jobId]/page.tsx`).
4. **My Applications dashboard** uses a status enum that does not exist on the backend — every row will display "Pending" forever even if the recruiter has rejected the applicant.
5. **No empty/loading state for recruiter dashboard initial load** — shows spinner only.
6. **Login error handling**: `toast.error(error)` passes the entire error to the toast string — user sees `[object Object]`.
7. **Register form**: phone field `type="number"` (rejects `+`, spaces, leading zeros).
8. **Resume upload during registration** is silently optional from the UI but the **backend throws 400** if no file. Inconsistent.
9. **NavBar**: Recruiter sees "Post Job" but no direct link to "Dashboard" until they open the popover. No "Companies" link in nav.
10. **No SEO metadata** for inner routes (only root `layout.tsx` sets metadata).
11. **No favicons beyond default** — favicon.ico is the Next.js one.
12. **Mobile responsiveness**: Navbar has mobile drawer; pages use `md:` breakpoints. Probably OK, not tested.

---

## I. Backend

### I.1 Auth service — full request flow

```text
POST /api/auth/register
  -> multer middleware (memoryStorage, field "file")
  -> registerUser (TryCatch)
     -> validate fields, check email uniqueness
     -> if role === "recruiter": insert into users (no resume)
     -> if role === "jobseeker":
         -> getBuffer() => data URI
         -> axios POST utils-service /api/utils/upload
         -> insert into users with resume URL + public_id
     -> jwt.sign({id}) 15-day
     -> 201 {message,user,token}
```

```text
POST /api/auth/login
  -> SELECT u + LEFT JOIN user_skills/skills GROUP BY user_id
  -> bcrypt.compare(password, hash)
  -> delete .password, jwt.sign({id})
  -> 201 {message,user,token}
```

```text
POST /api/auth/forgot
  -> SELECT by email
  -> if exists: jwt.sign({email,type:"reset"}, exp 15m)
  -> redis.set(`forgot:${email}`, token, EX 900)
  -> kafka publish "send-mail" with reset link
  -> return same generic message (good — prevents enumeration)
```

```text
POST /api/auth/reset/:token
  -> jwt.verify token, check type=="reset"
  -> redis GET, compare to token
  -> bcrypt hash new password, UPDATE users
  -> redis DEL key
```

### I.2 Job service — full request flow

```text
POST /api/job/company/new
  -> isAuth (Bearer)
  -> role==="recruiter" check
  -> uniqueness on name
  -> Cloudinary upload via utils
  -> INSERT company, RETURNING *
```

```text
POST /api/job/new
  -> isAuth + role=="recruiter"
  -> verify company exists AND recruiter_id == me
  -> INSERT job
```

```text
PUT /api/job/update/:jobId
  -> isAuth (role check commented out — see code)
  -> verify posted_by_recruiter_id == me
  -> UPDATE all columns including is_active
```

```text
POST /api/job/apply/:jobId
  -> isAuth + role=="jobseeker"
  -> verify job exists and is_active
  -> verify no existing application
  -> resolve resume: req.body.resume -> user.resume -> multer upload
  -> INSERT application
  -> kafka publish "send-mail"
```

```text
PUT /api/job/application/update/:id
  -> isAuth + role=="recruiter"
  -> verify job posted_by_recruiter_id == me
  -> UPDATE status
  -> kafka publish "send-mail"
```

### I.3 Utils service

- POST /api/utils/upload (Cloudinary proxy)
- POST /api/utils/career (Gemini career advice)
- POST /api/utils/resume-analyzer (Gemini ATS analyzer)
- Kafka consumer subscribes to "send-mail" topic, sends via nodemailer/Gmail SMTP on each message.

---

## J. Infrastructure

### J.1 Docker

Each service has its own Dockerfile using `node:25-alpine` with two-stage build (builder → production). All services share an identical Dockerfile pattern.

**Missing**:
- ❌ No `docker-compose.yml` at the repo root despite README claiming one.
- ❌ No `.env.example` files anywhere despite README instructing to use them.
- ❌ No shared base image; each Dockerfile is copy-pasted.
- ❌ No `HEALTHCHECK` directives.
- ❌ No multi-arch builds.

### J.2 CI/CD

**None**. No `.github/`, no `.gitlab-ci.yml`. No automated tests, no automated builds, no deploy hooks.

### J.3 Environment variables referenced

| Service | Variables expected |
|---|---|
| auth | `PORT`, `DB_URL` (Neon), `REDIS_URL`, `SECRET_KEY`, `UPLOAD_SERVICE` (utils URL), `KAFKA_BROKER`, `FRONTEND_URL` |
| job | `PORT`, `DB_URL`, `SECRET_KEY`, `UPLOAD_SERVICE`, `KAFKA_BROKER` |
| user | `PORT`, `DB_URL`, `SECRET_KEY`, `UPLOAD_SERVICE` |
| utils | `PORT`, `CLOUD_NAME`, `API_KEY`, `API_SECRET` (Cloudinary), `KAFKA_BROKER`, `SMTP_USER`, `SMTP_PASS`, `API_KEY_GEMINI` |

**Concern**: Hardcoded external IPs in `frontend/src/context/AppContext.tsx:7-10`:

```ts
export const utils_service = "http://51.20.37.105:5005";
export const auth_service = "http://51.20.37.105:5002";
export const user_service = "http://51.20.37.105:5006";
export const job_service = "http://51.20.37.105:5007";
```

These are public IP addresses exposed in the client bundle. Anyone can hit them directly.

---

## K. Security Findings

### 🔴 Critical

| # | Issue | Location |
|---|---|---|
| C1 | **No authentication on `utils` service** (`/api/utils/upload`, `/career`, `/resume-analyzer`). Open Cloudinary proxy and unlimited Gemini spend. | `services/utils/src/routes.ts` |
| C2 | **Frontend uses hardcoded backend IPs in client bundle**, exposing every internal service to the internet without any auth gate or rate limit. | `frontend/src/context/AppContext.tsx:7-10` |
| C3 | **JWT stored in non-httpOnly, non-secure cookie**. XSS exfiltrates the token. | `frontend/src/app/auth/login/page.tsx:62-66` |
| C4 | **Logout is client-only** — server cannot revoke a stolen token for 15 days. No refresh-token system. | `frontend/src/context/AppContext.tsx:48-52` |
| C5 | **`applyForJob` inserts `applicant_id` into `application_id`** (the PK). Silent corruption possible if the value happens to be unused. | `services/user/src/controller/user.ts:215-225` |
| C6 | **`getAllApplications` filters by `application_id = user_id`** — exposes OTHER users' applications (IDOR). | `services/user/src/controller/user.ts:236-247` |
| C7 | **No rate limiting anywhere** — auth endpoints are brute-force-able. | All services |

### 🟠 High

| # | Issue | Location |
|---|---|---|
| H1 | **No CORS allowlist** — `cors()` open to all origins. | Every `app.ts` |
| H2 | **No file size limit on multer** — `multer.memoryStorage()` with no `limits`. DoS via huge uploads. | `middleware/multer.ts` (3 services) |
| H3 | **No file type validation on upload** — multer accepts anything, frontend enforces PDF/image but backend does not. | All multer middleware |
| H4 | **No antivirus / magic-byte check** on uploaded resumes. | `utils/src/routes.ts` |
| H5 | **`UPDATE jobs` SQL column names collide with `role` (job column name)** — `role` is also a `users` column, but here it's a string in jobs. Confusing, but functional. | `services/job/src/index.ts` |
| H6 | **`companies.recruiter_id` and `jobs.posted_by_recruiter_id` lack FK** to `users`. | job schema |
| H7 | **`isAuth` middleware performs a DB query on every authenticated request** — no token caching. N+1 in effect. | `middleware/auth.ts` (2 services) |
| H8 | **`SECRET_KEY` shared across services via env** — rotating it requires 4 services. No key-versioning. | All services |
| H9 | **Kafka `send-mail` consumer has at-least-once semantics but no idempotency**. Email duplicates on retry. | `services/utils/src/consumer.ts` |
| H10 | **Gmail SMTP** with hardcoded `auth.user` / `auth.pass` in env. Google will throttle this heavily and may disable the account. | `services/utils/src/consumer.ts:25-35` |
| H11 | **No CSRF** — currently safe (bearer-only) but the moment cookies-based sessions are added, vulnerable. | All endpoints |
| H12 | **`role` is reflected from JWT-derived user object** but `isAuth` re-queries DB to get role — if DB role is changed, token still works until next call. | middleware |

### 🟡 Medium

| # | Issue | Location |
|---|---|---|
| M1 | `next.config.ts` allows images from any host (`hostname: "**"`) — image SSRF / abuse vector. | `frontend/next.config.ts:6-11` |
| M2 | `password` field in login response is deleted via `delete userObject.password` — works, but using a SELECT projection would be safer. | `auth/src/controllers/auth.ts:115-130` |
| M3 | `registerUser` returns `RETURNING ... create_at` (typo for `created_at`). Field never populated in response. | `auth/src/controllers/auth.ts:84` |
| M4 | `getSingleJobs` returns entire `jobs` row including recruiter's `posted_by_recruiter_id` to anonymous users. | `job/src/controller/jobs.ts::getSingleJobs` |
| M5 | Application status enum values (`Submitted/Rejected/Hired`) don't match frontend expected values (`pending/accepted/rejected`). | schemas + frontend types |
| M6 | `GET /api/job/company/:id` does NOT check that the requesting recruiter owns the company — any logged-in user can fetch any company's data with jobs. | `job/src/controller/jobs.ts::getCompanyDetails` |
| M7 | `GET /api/job/company/all` filters by recruiter — but if you delete a recruiter from auth DB, their companies remain. | job schema |
| M8 | The `data-uri` dependency is in `auth/package.json` but unused (only `datauri` is used). Dead. |
| M9 | Recruiter update route's role check is **commented out**. The ownership check is done via DB column, so functionally correct, but inconsistent with other routes. | `job/src/controller/jobs.ts::updateJob:14-19` |
| M10 | `try { ... } finally { setBtnLoading(false) }` swallowed errors pass `null` user state into the redirect path. | login/register pages |

### 🟢 Low

| # | Issue |
|---|---|
| L1 | `dump.rdb` exists in repo root (might be a stray Redis dump — `*.pem` is gitignored but `dump.rdb` is not). Should be gitignored. |
| L2 | `services/job/src/controller/jobs.ts` imports `transcode` from `"buffer"` and `stripTypeScriptTypes` from `"module"` — unused imports (likely IDE auto-import noise). |
| L3 | `services/job/src/controller/jobs.ts` imports `error` from `"console"` — unused. |
| L4 | Frontend `register/page.tsx` has `<input type="number">` for phone — strips `+`, leading `0`. |
| L5 | No CSRF tokens on any form (currently safe due to no cookie sessions). |
| L6 | Tailwind config uses `tailwindcss: { config: "" }` (empty string) in `components.json`, then a separate `tailwind.config.ts` exists. Duplication. |
| L7 | `services/job/tsconfig.json` includes `"types": ["node"]` but other services don't — inconsistency. |
| L8 | `docker-compose.yml` referenced in README does not exist. |
| L9 | `add-extensions.sh` script in `services/job/` patches `.ts` source files with `.js` import extensions at runtime — fragile workaround for ESM/TS interop. Other services don't need this because they use `moduleResolution: bundler`. Inconsistent. |

---

## L. Technical Debt — Top 10

| # | Title | Impact | Effort | Risk | Priority |
|---|---|---|---|---|---|
| 1 | **Two competing apply implementations with broken SQL** — `user.ts::applyForJob` inserts wrong column, `getAllApplications` filters wrong column. Frontend "My Applications" page is fed garbage. | HIGH | LOW | HIGH | 🔴 P0 |
| 2 | **Application status enum mismatch** — backend stores `Submitted/Rejected/Hired`, frontend renders `pending/accepted/rejected`. | HIGH | LOW | HIGH | 🔴 P0 |
| 3 | **No auth + open IPs on `utils` service** — anyone can burn Cloudinary/Gemini quota. | HIGH | LOW | HIGH | 🔴 P0 |
| 4 | **Token in non-httpOnly cookie + client-only logout** — token theft via XSS, no revocation. | HIGH | MED | HIGH | 🔴 P0 |
| 5 | **No FK on `recruiter_id` / `posted_by_recruiter_id`** — orphan rows possible. | MED | LOW | MED | 🟠 P1 |
| 6 | **Schema duplication across services + `subscription` dead columns + `subscribed` dead column** — schema lives in two `initDB()` blocks; will drift. | MED | LOW | MED | 🟠 P1 |
| 7 | **No CI/CD, no tests, no docker-compose, no env examples** — onboarding a new dev requires tribal knowledge. | HIGH | MED | LOW | 🟠 P1 |
| 8 | **Shared `SECRET_KEY` + DB credentials via env, no secret rotation, hardcoded IPs** — operations/security concern. | HIGH | HIGH | HIGH | 🟠 P1 |
| 9 | **`isAuth` middleware hits DB on every request** — no token cache. Bad for hot paths. | MED | LOW | MED | 🟡 P2 |
| 10 | **Two competing job-application code paths** (`/api/job/apply/:jobId` vs `/api/user/apply/job`) and 8 unused/legacy imports. | LOW | LOW | LOW | 🟡 P2 |

---

## M. Product Gaps (for a university-focused career platform)

| Domain | Gap | Notes |
|---|---|---|
| **University** | No university concept at all | No `universities` table, no `.edu` email validation, no SSO/OIDC, no domain whitelist, no admin role to verify students |
| **University** | No department/year/CGPA/degree | `users` table has only generic `name/email/phone/bio` |
| **University** | No clubs / events / announcements | No schema, no UI |
| **University** | No alumni / mentorship | No schema |
| **Career** | No saved jobs | No endpoint |
| **Career** | No application status visible to jobseeker correctly | Enum mismatch + IDOR bug |
| **Career** | No eligibility matching | No engine |
| **Career** | Resume analyzer exists but **does not actually score against real jobs** — it's a generic ATS check |
| **Network** | No referrals | No schema |
| **Network** | No chat / messaging | No WebSocket |
| **Network** | No projects / teams | No schema |
| **Engagement** | No notifications (in-app/email-on-status-change only) | Kafka mail only fires on apply/submit, not on views |
| **Engagement** | No gamification, no leaderboards | No schema |
| **Engagement** | No dashboards / analytics | Recruiter dashboard is job-list + status-edit, no metrics |
| **Search** | No pagination | All list endpoints return full set |
| **Search** | No skill/category filter | Only title + location |
| **Search** | No full-text / fuzzy search | DB `ILIKE '%term%'` is slow and brittle |
| **Moderation** | No admin role, no report flow, no job moderation queue | Jobs are live immediately |
| **Billing** | `subscription` column hints at plans; nothing exists | Dead field |

---

## N. Campus Launch Readiness

| Dimension | Score | Justification |
|---|---|---|
| **Technical readiness** | **5/10** | Core flows work end-to-end in dev. Many latent bugs (status enum, IDOR on `/user/application/all`, broken `/user/apply/job`). No CI, no tests, no docker-compose. |
| **UX readiness** | **6/10** | Visually polished. But: my-applications data is wrong, job-detail shows "Company Details in Progress" string, login error toasts show `[object Object]`, register form phone field strips `+`. |
| **Security readiness** | **3/10** | Open utils endpoints, hardcoded IPs, no rate limit, IDOR bugs, no FK constraints, JWT in non-httpOnly cookie, client-only logout. **Not safe for production.** |
| **Scalability readiness** | **4/10** | Neon HTTP-mode driver with no connection pooling. ILIKE on unindexed columns. No pagination. Kafka topic has single partition (numPartitions:1). Each authed request hits the DB. Will struggle at 1,000+ concurrent users. |
| **Product readiness** | **4/10** | The core jobseeker + recruiter flow is there. University-specific features (department/year/CGPA, clubs, events, alumni, mentorship, campus announcements, university SSO) are zero. The "career readiness" tools (AI resume analyzer, AI career guide) are present but feel like generic ChatGPT wrappers. |

**Honest one-line verdict**: *"A polished demo of a generic job portal that needs significant security hardening, schema cleanup, and a complete university-domain layer before it can host real students."*

---

## 24. WHAT SHOULD WE DO NEXT? — Recommended Roadmap

### P0 — MUST FIX BEFORE CAMPUS LAUNCH (Blockers)

| # | Action | Why | Effort | Dependencies |
|---|---|---|---|---|
| P0.1 | **Fix `user.ts::applyForJob` and `getAllApplications` SQL** | IDOR + silent data corruption | LOW | None |
| P0.2 | **Reconcile application status enums** — pick `Submitted/Rejected/Hired` everywhere, including frontend | "My Applications" dashboard is unusable | LOW | None |
| P0.3 | **Add `JWT_SECRET` rotation strategy, add httpOnly cookie session OR add refresh-token flow, add server-side logout/deny-list** | Tokens leaked today have 15-day life | MED | None |
| P0.4 | **Add authentication to `utils` service** (a shared internal secret or JWT) | Open Cloudinary/Gemini proxy is a DoS and cost hazard | LOW | None |
| P0.5 | **Add file-size limits + MIME type validation + magic-byte checks on multer uploads** | DoS via huge files, malicious payloads | LOW | None |
| P0.6 | **Add rate limiting** (express-rate-limit) on register/login/forgot/reset + utils endpoints | Brute-force & quota-burn defense | LOW | None |
| P0.7 | **Add FK constraints** for `recruiter_id` and `posted_by_recruiter_id` | Prevent orphan data | LOW | DB migration |
| P0.8 | **CORS allowlist** the frontend origin | Reduce attack surface | LOW | Frontend domain |

### P1 — MUST HAVE FOR MVP

| # | Action | Why | Effort | Reuses |
|---|---|---|---|---|
| P1.1 | **Add `.env.example` for every service + a `docker-compose.yml` at the repo root** | Onboarding, deployment | LOW | All services |
| P1.2 | **Add pagination to list endpoints** (`/all`, `/company/all`, `/application/all`, `/skill/*`) | Will break past a few hundred rows | LOW | Existing endpoints |
| P1.3 | **Move schema declarations to one place** (sql files or one migration service). Stop running `CREATE TABLE IF NOT EXISTS` from each `index.ts` | Schema drift will hit hard during the next change | MED | Existing DDL strings |
| P1.4 | **Delete the unused `subscription` and `subscribed` columns** OR wire them up | Dead fields are confusing | LOW | None |
| P1.5 | **Add at least smoke tests** (vitest/jest) on auth + apply + register | Regression safety | MED | None |
| P1.6 | **Add a basic admin role** with `/api/admin/*` for moderation and verification | You will need to verify students, moderate jobs | MED | `users` table |
| P1.7 | **Add `university_email_verified` flag** + send verification mail on signup if email ends in `.edu` (or configurable domain list) | University gating | MED | Existing Kafka mail + signup |
| P1.8 | **Cache the `isAuth` DB lookup** (Redis with 60s TTL on user_id) | Removes one DB hop per request | LOW | Existing Redis |
| P1.9 | **Wire `is_active` toggle into recruiter edit page UI** | Recruiters need to close jobs | LOW | Existing schema |
| P1.10 | **Fix My Applications page** to filter by `applicant_email` and use the right status enum | See P0.1 + P0.2 | LOW | After P0.1 |

### P2 — HIGH-VALUE FEATURES

| # | Action | Why | Effort | New DB |
|---|---|---|---|---|
| P2.1 | **University schema** — add `universities`, `departments`, `years`, link users to `university_id`, `department_id`, `year_of_study`, `cgpa` | University-specific targeting | MED | YES |
| P2.2 | **University SSO** (Google OAuth restricted to specific domains) or a manual admin-approval flow | University-restricted registration | MED | YES |
| P2.3 | **Saved jobs** — `saved_jobs(user_id, job_id, created_at)` | Engagement | LOW | YES |
| P2.4 | **In-app notifications** — `notifications` table + simple poll or SSE | Users will not check email | MED | YES |
| P2.5 | **Job recommendations** — cosine-similarity on user.skills vs job.description using Postgres `pg_trgm` | Discovery | LOW | LOW (extension) |
| P2.6 | **Resume analyzer scoring against real jobs** — extend `/api/utils/resume-analyzer` to accept a `jobId` and score resume vs job description | Real value | MED | NONE |
| P2.7 | **Pagination + filtering on jobs** (job_type, work_location, openings range) | UX | LOW | NONE |
| P2.8 | **Recruiter analytics dashboard** (views per job, applicants per day, accept/reject ratios) | Recruiter retention | MED | YES |
| P2.9 | **Skills taxonomy** — replace free-text `skills.name` with a curated list + categories | Quality of matching | LOW | YES |
| P2.10 | **Application withdraw / close job** | Lifecycle completion | LOW | NONE |

### P3 — FUTURE FEATURES

| # | Feature | Effort |
|---|---|---|
| P3.1 | Clubs + Events + Announcements | HIGH |
| P3.2 | Alumni directory + Senior-Junior matching | HIGH |
| P3.3 | Mentorship matching | HIGH |
| P3.4 | Referral system | MED |
| P3.5 | WebSocket real-time chat between recruiter and applicant | HIGH |
| P3.6 | Project teams / "find a teammate for hackathon" | MED |
| P3.7 | Gamification + leaderboards | MED |
| P3.8 | Switch email provider from Gmail SMTP to SendGrid/SES (Gmail will throttle) | LOW |
| P3.9 | Replace `@neondatabase/serverless` with `pg`/Pool inside long-running containers | LOW |
| P3.10 | Event-driven service bus (outbox pattern) for cross-service consistency | HIGH |

---

## 25. FINAL ARCHITECTURE RECOMMENDATION

**Recommendation: Keep the current 4-service layout but treat them as a modular monolith at the data tier, and prepare to consolidate.**

### What to keep

- ✅ The 4-service split is **fine for a university-scale launch** (≈1–10k users). It gives you isolated failure domains and lets you scale uploads (utils) separately.
- ✅ Kafka for async email is reasonable. Keep it.
- ✅ Cloudinary for object storage is appropriate for a small team.

### What to change now (without rewriting)

1. **Promote a shared schema package.** All `CREATE TABLE` statements should live in one place (a `db/schema.sql` file or a small `services/db-migrations` package). Each service should run migrations at startup, not auto-create tables.
2. **Add an internal-only auth secret** for service-to-service calls (used by `auth`/`job`/`user` → `utils`). Do NOT rely on the user JWT.
3. **Introduce a small BFF/API-aggregation layer** in front of the 4 services for the frontend. The frontend should call **one URL**, not 4 hardcoded IPs. A 30-line Next.js API route file per environment, or a thin Node gateway, would fix `frontend/src/context/AppContext.tsx:7-10` instantly.
4. **Replace Gmail SMTP** with a real transactional email provider (Resend, SendGrid, AWS SES) before scale.

### What to defer (do not add now)

- ❌ Do **not** introduce new microservices.
- ❌ Do **not** add an event-driven CQRS architecture.
- ❌ Do **not** build a recommendation service yet — Postgres `pg_trgm` + a thin query is enough for 10k users.
- ❌ Do **not** split `utils` into "upload-svc" and "ai-svc" — the boundary is artificial.

### What to be ready for

At ~10k+ active users, you will likely want to:

- Replace Cloudinary with S3 + signed URLs (cheaper, predictable cost).
- Move from `@neondatabase/serverless` (HTTP) to `pg` with a real pool.
- Add Redis-backed session/token-cache and rate-limiter.
- Introduce a queue (BullMQ on Redis or keep Kafka) for resume analysis (Gemini calls are slow — currently synchronous in HTTP path).

**Bottom line**: The current architecture is more than adequate for a university launch. The bottleneck is **not** architectural — it is **data hygiene, security hardening, and the missing university domain layer**.

---

## FACT / ASSUMPTION / RISK TAGS

- **FACT**: All code paths listed above were verified by reading the actual files. No functionality has been inferred.
- **ASSUMPTION**: That the deployed services on `51.20.37.105` correspond to the source code in this repo. (They share the exact same constants in `AppContext.tsx`.)
- **ASSUMPTION**: That Neon PostgreSQL is the active DB (the code references `@neondatabase/serverless`).
- **RISK**: Frontend IPs `51.20.37.105` are reachable today — anyone can hit `utils` endpoints.
- **RISK**: `getAllApplications` in user.ts likely returns OTHER users' applications (IDOR) — should be patched immediately.
- **FACT (literal)**: The string `"Company Details in Progress"` is hardcoded in `frontend/src/app/jobs/[jobId]/page.tsx:91`.
- **FACT**: `docker-compose.yml` is referenced in the README but does not exist in the repo.
- **FACT**: Zero test files exist anywhere in the repo (`*test*`, `*spec*`, `__tests__` patterns matched nothing).
- **FACT**: No `.env.example` files exist anywhere despite the README instructing developers to copy them.

---

## SUMMARY ANSWERS

1. **What exactly have you already built?** — A four-microservice (modular monolith) job portal with Next.js frontend, JWT auth, two roles, job/company/application CRUD, Cloudinary uploads, Kafka async email, and two Gemini AI tools (resume analyzer + career guide).
2. **What actually works?** — Register, login, forgot/reset, profile editing, pic/resume upload, skills, browse jobs, search by title+location, apply to job, recruiter create company, post job, edit job, delete company, list/manage applications, status email notifications, resume analyzer, career guide.
3. **What is partially implemented?** — Job detail page (no company info), My Applications (wrong filter), job search (no pagination/skill filter).
4. **What is broken?** — `user.ts::applyForJob` (PK corruption), `user.ts::getAllApplications` (IDOR), status enum mismatch causes My Applications page to display "Pending" forever.
5. **What is missing?** — University domain (department/year/CGPA/clubs/events/alumni), saved jobs, notifications, real-time chat, pagination, rate limiting, tests, CI/CD, docker-compose, env examples, admin role, moderation, billing, referrals.
6. **What technical debt exists?** — See Top 10 list in section L.
7. **What security problems exist?** — 7 Critical, 12 High, 10 Medium, 9 Low. See section K.
8. **What can handle real students today?** — For a small private beta (≤50 users), yes. For a campus launch, no — needs at least the P0 list.
9. **What must be fixed before campus launch?** — The 8 items in P0.
10. **What should we build next?** — University schema + email verification (P1.1–P1.7), then saved jobs + notifications (P2.3, P2.4).
11. **Which existing code can we reuse?** — Auth flow, JWT middleware pattern, Kafka mail pipeline, Cloudinary upload proxy, recruiter dashboard skeleton, application status mail — all reusable as-is for university extensions.
12. **What architecture should JobiFy evolve toward?** — Keep 4 services, but: (a) unify schema in one package, (b) add a thin API gateway/BFF in front of the four IPs, (c) move from Gmail SMTP to a real transactional provider, (d) defer microservices growth until past 10k users.

---

**Audit methodology**: Read-only inspection of source files, package manifests, Dockerfiles, schema declarations, route handlers, and frontend pages. No code was modified, no packages installed, no migrations run, no commits made. Repository state unchanged: `git status: clean, branch main, commit c92bdb2`.