import json
import logging

_STANDARD_LOG_ATTRS = frozenset({
    "args", "created", "exc_info", "exc_text", "filename", "funcName",
    "id", "levelname", "levelno", "lineno", "message", "module", "msecs",
    "msg", "name", "pathname", "process", "processName", "relativeCreated",
    "stack_info", "thread", "threadName", "taskName",
})


class _StructuredFormatter(logging.Formatter):
    """Single-line structured formatter: timestamp  LEVEL  name  message  {extra JSON}"""

    def format(self, record: logging.LogRecord) -> str:
        record.message = record.getMessage()
        ts = self.formatTime(record, self.datefmt)
        parts = [f"{ts}  {record.levelname:<8}  {record.name}  {record.message}"]
        extra = {k: v for k, v in record.__dict__.items() if k not in _STANDARD_LOG_ATTRS}
        if extra:
            parts.append(json.dumps(extra, default=str))
        if record.exc_info:
            parts.append(self.formatException(record.exc_info))
        return "  ".join(parts)


def get_logger(name: str, level: str = "INFO") -> logging.Logger:
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))
    handler = logging.StreamHandler()
    handler.setFormatter(_StructuredFormatter(datefmt="%Y-%m-%dT%H:%M:%S"))
    logger.addHandler(handler)
    logger.propagate = False
    return logger
