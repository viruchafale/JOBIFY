/**
 * Phase 3 — External jobs read API. Phase 7 — advanced search.
 *
 * Minimal read surface over normalized external jobs. Uses the existing
 * error envelope (TryCatch + ErrorHandler) and observability middleware.
 * Served through the Gateway at GET /api/job/external (no gateway change
 * needed — /api/job/* is already proxied to the job service).
 */

import { sql } from "../utils/db.js";
import ErrorHandler from "../utils/errorHandler.js";
import { TryCatch } from "../utils/TryCatch.js";
import {
  getExternalJobById,
  listExternalJobs,
  parseExternalJobFilters,
} from "../ingestion/repository.js";
import { parseExternalJobSearchParams, searchExternalJobs } from "../ingestion/search.js";
import { sourceRegistry } from "../ingestion/sources/index.js";

export const listExternalJobsHandler = TryCatch(async (req, res) => {
  let filters;
  try {
    filters = parseExternalJobFilters(req.query);
  } catch (error) {
    throw new ErrorHandler(400, (error as Error).message);
  }
  const jobs = await listExternalJobs(sql as any, filters);
  res.json(jobs);
});

export const searchExternalJobsHandler = TryCatch(async (req, res) => {
  let params;
  try {
    const knownSources = sourceRegistry.list().map((definition) => definition.source);
    params = parseExternalJobSearchParams(req.query, knownSources);
  } catch (error) {
    throw new ErrorHandler(400, (error as Error).message);
  }

  const { items, total } = await searchExternalJobs(sql as any, params);
  const totalPages = total === 0 ? 0 : Math.ceil(total / params.limit);

  res.json({
    data: {
      items,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages,
      },
    },
  });
});

export const getExternalJobByIdHandler = TryCatch(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    throw new ErrorHandler(400, "Invalid external job id.");
  }
  const job = await getExternalJobById(sql as any, id);
  if (!job) {
    throw new ErrorHandler(404, "External job not found.");
  }
  res.json(job);
});
