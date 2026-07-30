from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
import sqlite3

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel


BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = BASE_DIR / "gateway.db"
STATIC_DIR = BASE_DIR / "static"

ENVIRONMENT_DEVICE = "environment_node_01"
SENSOR_NODE_2 = "sensor_node_02"

NODE_1_STALE_SECONDS = 30
NODE_2_STALE_SECONDS = 30
HIGH_TEMPERATURE_C = 30.0
LOW_TEMPERATURE_C = 10.0
HIGH_HUMIDITY_PERCENT = 75.0
LOW_LIGHT_LUX = 20.0
MOTION_DARK_WINDOW_SECONDS = 30

app = FastAPI(title="Sovereign Edge Gateway")

app.mount(
    "/static",
    StaticFiles(directory=STATIC_DIR),
    name="static",
)


class SensorReading(BaseModel):
    device: str
    temperature: float
    pressure: float
    humidity: Optional[float] = None


class MotionEvent(BaseModel):
    device: str
    motion: bool


class LightReading(BaseModel):
    device: str
    lux: float


def get_database_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(
        DATABASE_PATH,
        timeout=10,
    )
    connection.row_factory = sqlite3.Row
    return connection


def initialise_database() -> None:
    with get_database_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sensor_readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device TEXT NOT NULL,
                temperature REAL NOT NULL,
                pressure REAL NOT NULL,
                humidity REAL,
                received_at TEXT NOT NULL
            )
            """
        )

        columns = {
            row["name"]
            for row in connection.execute(
                "PRAGMA table_info(sensor_readings)"
            ).fetchall()
        }

        if "humidity" not in columns:
            connection.execute(
                """
                ALTER TABLE sensor_readings
                ADD COLUMN humidity REAL
                """
            )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS motion_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device TEXT NOT NULL,
                motion INTEGER NOT NULL,
                received_at TEXT NOT NULL
            )
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS light_readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device TEXT NOT NULL,
                lux REAL NOT NULL,
                received_at TEXT NOT NULL
            )
            """
        )

        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS
            idx_sensor_readings_device_id
            ON sensor_readings(device, id DESC)
            """
        )

        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS
            idx_motion_events_device_id
            ON motion_events(device, id DESC)
            """
        )

        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS
            idx_light_readings_device_id
            ON light_readings(device, id DESC)
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                alert_key TEXT NOT NULL,
                alert_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                device TEXT,
                message TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                acknowledged INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                resolved_at TEXT
            )
            """
        )

        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_alerts_active
            ON alerts(active, created_at DESC)
            """
        )

        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_alerts_key
            ON alerts(alert_key, active)
            """
        )


def utc_now() -> datetime:
    return datetime.now(
        timezone.utc
    )


def parse_utc_timestamp(
    value: Optional[str],
) -> Optional[datetime]:
    if not value:
        return None

    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(
            tzinfo=timezone.utc
        )

    return parsed.astimezone(
        timezone.utc
    )


def seconds_since(
    timestamp: Optional[str],
    now: datetime,
) -> Optional[int]:
    parsed = parse_utc_timestamp(timestamp)

    if parsed is None:
        return None

    return max(
        0,
        int(
            (
                now - parsed
            ).total_seconds()
        ),
    )


def fetch_latest_sensor_reading(
    connection: sqlite3.Connection,
) -> Optional[dict]:
    row = connection.execute(
        """
        SELECT
            id,
            device,
            temperature,
            pressure,
            humidity,
            received_at
        FROM sensor_readings
        ORDER BY id DESC
        LIMIT 1
        """
    ).fetchone()

    return dict(row) if row else None


def fetch_latest_light_reading(
    connection: sqlite3.Connection,
) -> Optional[dict]:
    row = connection.execute(
        """
        SELECT
            id,
            device,
            lux,
            received_at
        FROM light_readings
        ORDER BY id DESC
        LIMIT 1
        """
    ).fetchone()

    return dict(row) if row else None


def fetch_latest_motion_event(
    connection: sqlite3.Connection,
) -> Optional[dict]:
    row = connection.execute(
        """
        SELECT
            id,
            device,
            motion,
            received_at
        FROM motion_events
        ORDER BY id DESC
        LIMIT 1
        """
    ).fetchone()

    if not row:
        return None

    result = dict(row)
    result["motion"] = bool(
        result["motion"]
    )
    return result


def set_alert_state(
    connection: sqlite3.Connection,
    alert_key: str,
    alert_type: str,
    severity: str,
    device: Optional[str],
    message: str,
    condition_active: bool,
    now: datetime,
) -> None:
    timestamp = now.isoformat()

    if condition_active:
        active_alert = connection.execute(
            """
            SELECT id
            FROM alerts
            WHERE alert_key = ?
              AND active = 1
            ORDER BY id DESC
            LIMIT 1
            """,
            (alert_key,),
        ).fetchone()

        if active_alert:
            connection.execute(
                """
                UPDATE alerts
                SET
                    alert_type = ?,
                    severity = ?,
                    device = ?,
                    message = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    alert_type,
                    severity,
                    device,
                    message,
                    timestamp,
                    active_alert["id"],
                ),
            )
        else:
            connection.execute(
                """
                INSERT INTO alerts (
                    alert_key,
                    alert_type,
                    severity,
                    device,
                    message,
                    active,
                    acknowledged,
                    created_at,
                    updated_at,
                    resolved_at
                )
                VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, NULL)
                """,
                (
                    alert_key,
                    alert_type,
                    severity,
                    device,
                    message,
                    timestamp,
                    timestamp,
                ),
            )

        return

    connection.execute(
        """
        UPDATE alerts
        SET
            active = 0,
            updated_at = ?,
            resolved_at = ?
        WHERE alert_key = ?
          AND active = 1
        """,
        (
            timestamp,
            timestamp,
            alert_key,
        ),
    )


def evaluate_measurement_alerts(
    connection: sqlite3.Connection,
    now: Optional[datetime] = None,
) -> None:
    now = now or utc_now()
    latest_sensor = fetch_latest_sensor_reading(
        connection
    )
    latest_light = fetch_latest_light_reading(
        connection
    )
    latest_motion = fetch_latest_motion_event(
        connection
    )

    temperature = (
        latest_sensor["temperature"]
        if latest_sensor
        else None
    )
    humidity = (
        latest_sensor["humidity"]
        if latest_sensor
        else None
    )
    lux = (
        latest_light["lux"]
        if latest_light
        else None
    )

    set_alert_state(
        connection,
        "high_temperature",
        "temperature",
        "warning",
        ENVIRONMENT_DEVICE,
        (
            f"High temperature: {temperature:.1f} C exceeds "
            f"{HIGH_TEMPERATURE_C:.1f} C."
        )
        if temperature is not None
        else "High temperature threshold exceeded.",
        temperature is not None
        and temperature > HIGH_TEMPERATURE_C,
        now,
    )

    set_alert_state(
        connection,
        "low_temperature",
        "temperature",
        "info",
        ENVIRONMENT_DEVICE,
        (
            f"Low temperature: {temperature:.1f} C below "
            f"{LOW_TEMPERATURE_C:.1f} C."
        )
        if temperature is not None
        else "Low temperature threshold exceeded.",
        temperature is not None
        and temperature < LOW_TEMPERATURE_C,
        now,
    )

    set_alert_state(
        connection,
        "high_humidity",
        "humidity",
        "warning",
        ENVIRONMENT_DEVICE,
        (
            f"High humidity: {humidity:.0f}% exceeds "
            f"{HIGH_HUMIDITY_PERCENT:.0f}%."
        )
        if humidity is not None
        else "High humidity threshold exceeded.",
        humidity is not None
        and humidity > HIGH_HUMIDITY_PERCENT,
        now,
    )

    set_alert_state(
        connection,
        "low_light",
        "light",
        "info",
        SENSOR_NODE_2,
        (
            f"Low light: {lux:.1f} lux below "
            f"{LOW_LIGHT_LUX:.1f} lux."
        )
        if lux is not None
        else "Low light threshold exceeded.",
        lux is not None
        and lux < LOW_LIGHT_LUX,
        now,
    )

    motion_age = seconds_since(
        latest_motion["received_at"]
        if latest_motion
        else None,
        now,
    )
    light_age = seconds_since(
        latest_light["received_at"]
        if latest_light
        else None,
        now,
    )
    motion_in_darkness = (
        latest_motion is not None
        and latest_motion["motion"]
        and lux is not None
        and lux < LOW_LIGHT_LUX
        and motion_age is not None
        and motion_age <= MOTION_DARK_WINDOW_SECONDS
        and light_age is not None
        and light_age <= MOTION_DARK_WINDOW_SECONDS
    )

    set_alert_state(
        connection,
        "motion_in_darkness",
        "motion",
        "critical",
        SENSOR_NODE_2,
        (
            f"Motion detected while light is {lux:.1f} lux."
        )
        if lux is not None
        else "Motion detected in darkness.",
        motion_in_darkness,
        now,
    )


def evaluate_stale_alerts(
    connection: sqlite3.Connection,
    now: Optional[datetime] = None,
) -> None:
    now = now or utc_now()
    latest_sensor = fetch_latest_sensor_reading(
        connection
    )
    latest_light = fetch_latest_light_reading(
        connection
    )

    node_1_age = seconds_since(
        latest_sensor["received_at"]
        if latest_sensor
        else None,
        now,
    )
    node_2_age = seconds_since(
        latest_light["received_at"]
        if latest_light
        else None,
        now,
    )

    set_alert_state(
        connection,
        "node1_stale",
        "node_stale",
        "warning",
        ENVIRONMENT_DEVICE,
        (
            f"Environment node stale: last reading "
            f"{node_1_age} seconds ago."
        )
        if node_1_age is not None
        else "No environment readings have been received.",
        node_1_age is None
        or node_1_age > NODE_1_STALE_SECONDS,
        now,
    )

    set_alert_state(
        connection,
        "node2_stale",
        "node_stale",
        "warning",
        SENSOR_NODE_2,
        (
            f"Sensor node 2 stale: last light reading "
            f"{node_2_age} seconds ago."
        )
        if node_2_age is not None
        else "No light readings have been received from sensor node 2.",
        node_2_age is None
        or node_2_age > NODE_2_STALE_SECONDS,
        now,
    )


def evaluate_alerts(
    connection: sqlite3.Connection,
    include_stale: bool = False,
) -> None:
    now = utc_now()
    evaluate_measurement_alerts(
        connection,
        now,
    )

    if include_stale:
        evaluate_stale_alerts(
            connection,
            now,
        )


def node_status_from_row(
    row: Optional[dict],
    stale_seconds: int,
    now: datetime,
) -> dict:
    last_seen = (
        row["received_at"]
        if row
        else None
    )
    age = seconds_since(
        last_seen,
        now,
    )

    return {
        "status": (
            "online"
            if age is not None
            and age <= stale_seconds
            else "stale"
        ),
        "last_seen": last_seen,
        "age_seconds": age,
    }


def gateway_uptime_seconds() -> Optional[int]:
    try:
        uptime_text = Path(
            "/proc/uptime"
        ).read_text(
            encoding="utf-8"
        )
    except OSError:
        return None

    try:
        return int(
            float(
                uptime_text.split()[0]
            )
        )
    except (
        IndexError,
        ValueError,
    ):
        return None


def serialize_alert(
    row: sqlite3.Row,
) -> dict:
    result = dict(row)
    result["active"] = bool(
        result["active"]
    )
    result["acknowledged"] = bool(
        result["acknowledged"]
    )
    return result


initialise_database()


@app.get("/")
def home():
    return {
        "service": "sovereign-edge-gateway",
        "status": "running",
        "dashboard": "/dashboard",
    }


@app.get("/dashboard", include_in_schema=False)
def dashboard():
    return FileResponse(
        STATIC_DIR / "dashboard.html"
    )


@app.get("/health")
def health():
    with get_database_connection() as connection:
        connection.execute("SELECT 1").fetchone()

    return {
        "status": "ok",
        "database": "connected",
        "timestamp": datetime.now(
            timezone.utc
        ).isoformat(),
    }


@app.get("/system/status")
def system_status():
    generated_at = utc_now()

    try:
        with get_database_connection() as connection:
            connection.execute("SELECT 1").fetchone()
            evaluate_alerts(
                connection,
                include_stale=True,
            )

            sensor_count = connection.execute(
                "SELECT COUNT(*) AS count FROM sensor_readings"
            ).fetchone()["count"]
            motion_count = connection.execute(
                "SELECT COUNT(*) AS count FROM motion_events"
            ).fetchone()["count"]
            light_count = connection.execute(
                "SELECT COUNT(*) AS count FROM light_readings"
            ).fetchone()["count"]
            alert_count = connection.execute(
                "SELECT COUNT(*) AS count FROM alerts"
            ).fetchone()["count"]

            latest_sensor = fetch_latest_sensor_reading(
                connection
            )
            latest_light = fetch_latest_light_reading(
                connection
            )

    except sqlite3.Error as error:
        return {
            "api": {
                "status": "online"
            },
            "database": {
                "status": "error",
                "error": str(error),
                "sensor_readings": None,
                "motion_events": None,
                "light_readings": None,
                "alerts": None,
            },
            "nodes": {
                ENVIRONMENT_DEVICE: {
                    "status": "unknown",
                    "last_seen": None,
                    "age_seconds": None,
                },
                SENSOR_NODE_2: {
                    "status": "unknown",
                    "last_seen": None,
                    "age_seconds": None,
                },
            },
            "gateway": {
                "uptime_seconds": gateway_uptime_seconds()
            },
            "generated_at": generated_at.isoformat(),
        }

    return {
        "api": {
            "status": "online"
        },
        "database": {
            "status": "online",
            "sensor_readings": sensor_count,
            "motion_events": motion_count,
            "light_readings": light_count,
            "alerts": alert_count,
        },
        "nodes": {
            ENVIRONMENT_DEVICE: node_status_from_row(
                latest_sensor,
                NODE_1_STALE_SECONDS,
                generated_at,
            ),
            SENSOR_NODE_2: node_status_from_row(
                latest_light,
                NODE_2_STALE_SECONDS,
                generated_at,
            ),
        },
        "gateway": {
            "uptime_seconds": gateway_uptime_seconds()
        },
        "generated_at": generated_at.isoformat(),
    }


@app.get("/alerts")
def active_alerts(
    active: bool = Query(default=True),
    limit: int = Query(
        default=50,
        ge=1,
        le=200,
    ),
):
    with get_database_connection() as connection:
        evaluate_alerts(
            connection,
            include_stale=True,
        )
        rows = connection.execute(
            """
            SELECT
                id,
                alert_key,
                alert_type,
                severity,
                device,
                message,
                active,
                acknowledged,
                created_at,
                updated_at,
                resolved_at
            FROM alerts
            WHERE active = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (
                int(active),
                limit,
            ),
        ).fetchall()

    alerts = [
        serialize_alert(row)
        for row in rows
    ]

    return {
        "count": len(alerts),
        "alerts": alerts,
    }


@app.get("/alerts/history")
def alert_history(
    limit: int = Query(
        default=50,
        ge=1,
        le=500,
    ),
):
    with get_database_connection() as connection:
        evaluate_alerts(
            connection,
            include_stale=True,
        )
        rows = connection.execute(
            """
            SELECT
                id,
                alert_key,
                alert_type,
                severity,
                device,
                message,
                active,
                acknowledged,
                created_at,
                updated_at,
                resolved_at
            FROM alerts
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    alerts = [
        serialize_alert(row)
        for row in rows
    ]

    return {
        "count": len(alerts),
        "alerts": alerts,
    }


@app.post("/alerts/{alert_id}/acknowledge")
def acknowledge_alert(
    alert_id: int,
):
    with get_database_connection() as connection:
        alert = connection.execute(
            """
            SELECT id
            FROM alerts
            WHERE id = ?
            """,
            (alert_id,),
        ).fetchone()

        if not alert:
            raise HTTPException(
                status_code=404,
                detail="Alert not found",
            )

        connection.execute(
            """
            UPDATE alerts
            SET
                acknowledged = 1,
                updated_at = ?
            WHERE id = ?
            """,
            (
                utc_now().isoformat(),
                alert_id,
            ),
        )

    return {
        "status": "acknowledged",
        "alert_id": alert_id,
    }


@app.post("/sensor")
def receive_sensor(reading: SensorReading):
    received_at = datetime.now(
        timezone.utc
    ).isoformat()

    with get_database_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO sensor_readings (
                device,
                temperature,
                pressure,
                humidity,
                received_at
            )
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                reading.device,
                reading.temperature,
                reading.pressure,
                reading.humidity,
                received_at,
            ),
        )

        reading_id = cursor.lastrowid
        evaluate_alerts(connection)

    return {
        "status": "received",
        "data": {
            "id": reading_id,
            "device": reading.device,
            "temperature": reading.temperature,
            "pressure": reading.pressure,
            "humidity": reading.humidity,
            "received_at": received_at,
        },
    }


@app.get("/latest")
def latest_sensor(
    device: Optional[str] = None,
):
    sql = """
        SELECT
            id,
            device,
            temperature,
            pressure,
            humidity,
            received_at
        FROM sensor_readings
    """

    parameters = []

    if device:
        sql += " WHERE device = ?"
        parameters.append(device)

    sql += " ORDER BY id DESC LIMIT 1"

    with get_database_connection() as connection:
        row = connection.execute(
            sql,
            parameters,
        ).fetchone()

    return {
        "latest_reading": (
            dict(row) if row else None
        )
    }


@app.get("/history")
def sensor_history(
    limit: int = Query(
        default=50,
        ge=1,
        le=1000,
    ),
    device: Optional[str] = None,
):
    sql = """
        SELECT
            id,
            device,
            temperature,
            pressure,
            humidity,
            received_at
        FROM sensor_readings
    """

    parameters = []

    if device:
        sql += " WHERE device = ?"
        parameters.append(device)

    sql += " ORDER BY id DESC LIMIT ?"
    parameters.append(limit)

    with get_database_connection() as connection:
        rows = connection.execute(
            sql,
            parameters,
        ).fetchall()

    return {
        "count": len(rows),
        "readings": [
            dict(row) for row in rows
        ],
    }


@app.post("/motion")
def receive_motion(event: MotionEvent):
    received_at = datetime.now(
        timezone.utc
    ).isoformat()

    with get_database_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO motion_events (
                device,
                motion,
                received_at
            )
            VALUES (?, ?, ?)
            """,
            (
                event.device,
                int(event.motion),
                received_at,
            ),
        )

        event_id = cursor.lastrowid
        evaluate_alerts(connection)

    return {
        "status": "received",
        "data": {
            "id": event_id,
            "device": event.device,
            "motion": event.motion,
            "received_at": received_at,
        },
    }


@app.get("/motion/latest")
def latest_motion():
    with get_database_connection() as connection:
        row = connection.execute(
            """
            SELECT
                id,
                device,
                motion,
                received_at
            FROM motion_events
            ORDER BY id DESC
            LIMIT 1
            """
        ).fetchone()

    if not row:
        return {"latest_motion": None}

    result = dict(row)
    result["motion"] = bool(
        result["motion"]
    )

    return {
        "latest_motion": result
    }


@app.get("/motion/history")
def motion_history(
    limit: int = Query(
        default=50,
        ge=1,
        le=1000,
    )
):
    with get_database_connection() as connection:
        rows = connection.execute(
            """
            SELECT
                id,
                device,
                motion,
                received_at
            FROM motion_events
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    events = []

    for row in rows:
        item = dict(row)
        item["motion"] = bool(
            item["motion"]
        )
        events.append(item)

    return {
        "count": len(events),
        "events": events,
    }


@app.post("/light")
def receive_light(reading: LightReading):
    received_at = datetime.now(
        timezone.utc
    ).isoformat()

    with get_database_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO light_readings (
                device,
                lux,
                received_at
            )
            VALUES (?, ?, ?)
            """,
            (
                reading.device,
                reading.lux,
                received_at,
            ),
        )

        reading_id = cursor.lastrowid
        evaluate_alerts(connection)

    return {
        "status": "received",
        "data": {
            "id": reading_id,
            "device": reading.device,
            "lux": reading.lux,
            "received_at": received_at,
        },
    }


@app.get("/light/latest")
def latest_light():
    with get_database_connection() as connection:
        row = connection.execute(
            """
            SELECT
                id,
                device,
                lux,
                received_at
            FROM light_readings
            ORDER BY id DESC
            LIMIT 1
            """
        ).fetchone()

    return {
        "latest_light": (
            dict(row) if row else None
        )
    }


@app.get("/light/history")
def light_history(
    limit: int = Query(
        default=50,
        ge=1,
        le=1000,
    )
):
    with get_database_connection() as connection:
        rows = connection.execute(
            """
            SELECT
                id,
                device,
                lux,
                received_at
            FROM light_readings
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    return {
        "count": len(rows),
        "readings": [
            dict(row) for row in rows
        ],
    }
