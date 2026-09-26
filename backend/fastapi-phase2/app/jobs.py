"""Background jobs, kept as small as the problem actually is.

A patient takes about seventy seconds to measure, which is too long to hold an HTTP
request open and nowhere near long enough to justify a queue server. So: one worker
thread, an in-memory register of jobs, and a status endpoint the client polls.

The worker is deliberately single. Both models and LoFTR sit on one GPU with a few
gigabytes of memory between them, so running two patients at once would not be twice as
fast -- it would be the same speed until it ran out of memory.

Jobs live in memory and die with the process. The gateway stores the result the moment a
job finishes, so nothing durable depends on this register.
"""

import logging
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

logger = logging.getLogger("rop.phase2.jobs")

QUEUED, RUNNING, DONE, FAILED = "queued", "running", "done", "failed"


@dataclass
class Job:
    id: str
    status: str = QUEUED
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    step: str = "waiting for the analyser"
    progress: Dict = field(default_factory=lambda: {"done": 0, "total": 0})
    result: Optional[Dict] = None
    error: Optional[str] = None

    def status_payload(self) -> Dict:
        """What the poller gets. The result is fetched separately once done."""
        finished = self.finished_at or time.time()
        return {
            "job_id": self.id,
            "status": self.status,
            "step": self.step,
            "progress": dict(self.progress),
            "queued_for": round((self.started_at or finished) - self.created_at, 1),
            "seconds": round(finished - (self.started_at or finished), 1),
            "error": self.error,
        }

    def advance(self, step: str, done: Optional[int] = None,
                total: Optional[int] = None) -> None:
        self.step = step
        if done is not None:
            self.progress["done"] = done
        if total is not None:
            self.progress["total"] = total


class JobStore:
    """Submit work, ask about it later. Nothing more."""

    def __init__(self, keep: int = 64):
        self._jobs: Dict[str, Job] = {}
        self._order: List[str] = []
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="phase2")
        self._keep = keep

    def reserve(self) -> Job:
        """Register a job and hand back its id, without queueing any work yet.

        The uploaded photographs are written into a folder named after the job, so the
        id has to exist before there is anything for the worker to do.
        """
        job = Job(id=uuid.uuid4().hex)
        with self._lock:
            self._jobs[job.id] = job
            self._order.append(job.id)
            self._evict()
        return job

    def start(self, job: Job, work: Callable[[Job], Dict]) -> Job:
        self._pool.submit(self._run, job, work)
        return job

    def submit(self, work: Callable[[Job], Dict]) -> Job:
        return self.start(self.reserve(), work)

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)

    def _run(self, job: Job, work: Callable[[Job], Dict]) -> None:
        job.started_at = time.time()
        job.status = RUNNING
        try:
            job.result = work(job)
            job.status = DONE
            job.step = "complete"
        except Exception as exc:                    # a job failing must not kill the worker
            job.status = FAILED
            job.step = "failed"
            job.error = "%s: %s" % (type(exc).__name__, exc)
            logger.error("job %s failed\n%s", job.id, traceback.format_exc())
        finally:
            job.finished_at = time.time()

    def _evict(self) -> None:
        """Forget the oldest finished jobs. Called with the lock held."""
        while len(self._order) > self._keep:
            oldest = self._order[0]
            if self._jobs.get(oldest, Job(id=oldest)).status in (QUEUED, RUNNING):
                break
            self._order.pop(0)
            self._jobs.pop(oldest, None)
