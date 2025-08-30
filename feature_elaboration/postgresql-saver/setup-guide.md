# PostgreSQL Saver Setup Guide for LangGraph

This guide provides step-by-step instructions for setting up PostgreSQL as a checkpoint saver and store backend for LangGraph applications.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Database Setup](#database-setup)
4. [Application Configuration](#application-configuration)
5. [Docker Setup](#docker-setup)
6. [Production Deployment](#production-deployment)
7. [Monitoring and Maintenance](#monitoring-and-maintenance)
8. [Troubleshooting](#troubleshooting)

## Prerequisites

### System Requirements

- **Operating System**: Linux, macOS, or Windows
- **Python**: 3.8+ (recommended: 3.9+)
- **PostgreSQL**: 12+ (recommended: 14+)
- **Memory**: Minimum 2GB RAM (4GB+ recommended)
- **Storage**: Minimum 10GB available space

### Software Dependencies

```bash
# Core Python packages
python3 -m pip install --upgrade pip
python3 -m pip install langgraph langgraph-checkpoint-postgres

# Database driver
python3 -m pip install "psycopg[binary,pool]"

# Optional: Encryption support
python3 -m pip install pycryptodome

# Optional: Development tools
python3 -m pip install psycopg2-binary  # Alternative driver
```

## Environment Setup

### 1. Python Virtual Environment

```bash
# Create virtual environment
python3 -m venv langgraph-postgres-env

# Activate virtual environment
# On Linux/macOS:
source langgraph-postgres-env/bin/activate

# On Windows:
langgraph-postgres-env\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Environment Variables

Create a `.env` file in your project root:

```bash
# PostgreSQL Connection
POSTGRES_URI=postgresql://username:password@localhost:5432/langgraph_db?sslmode=disable

# Optional: Encrypted checkpoints
LANGGRAPH_AES_KEY=your_32_character_aes_key_here

# Optional: Custom PostgreSQL instance
POSTGRES_URI_CUSTOM=postgres://user:pass@/db?host=hostname

# Optional: Application settings
LANGGRAPH_LOG_LEVEL=INFO
LANGGRAPH_ENVIRONMENT=development
```

### 3. Requirements File

Create `requirements.txt`:

```txt
# Core LangGraph
langgraph>=0.2.0
langgraph-checkpoint-postgres>=0.1.0

# Database drivers
psycopg[binary,pool]>=3.0.0

# Optional: Encryption
pycryptodome>=3.15.0

# Optional: Development
pytest>=7.0.0
black>=22.0.0
flake8>=5.0.0
```

## Database Setup

### 1. PostgreSQL Installation

#### Ubuntu/Debian
```bash
# Update package list
sudo apt update

# Install PostgreSQL
sudo apt install postgresql postgresql-contrib

# Start and enable PostgreSQL service
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Check status
sudo systemctl status postgresql
```

#### macOS (using Homebrew)
```bash
# Install PostgreSQL
brew install postgresql

# Start PostgreSQL service
brew services start postgresql

# Check status
brew services list | grep postgresql
```

#### Windows
1. Download PostgreSQL installer from [postgresql.org](https://www.postgresql.org/download/windows/)
2. Run installer with default settings
3. Note the password for the `postgres` user
4. PostgreSQL service starts automatically

### 2. Database Configuration

#### Create Database and User

```bash
# Connect to PostgreSQL as superuser
sudo -u postgres psql

# Create database
CREATE DATABASE langgraph_db;

# Create user
CREATE USER langgraph_user WITH PASSWORD 'your_secure_password';

# Grant privileges
GRANT ALL PRIVILEGES ON DATABASE langgraph_db TO langgraph_user;

# Grant schema privileges
GRANT ALL ON SCHEMA public TO langgraph_user;

# Exit PostgreSQL
\q
```

#### Alternative: Using psql

```bash
# Connect to PostgreSQL
psql -U postgres -h localhost

# Create database and user
CREATE DATABASE langgraph_db;
CREATE USER langgraph_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE langgraph_db TO langgraph_user;
GRANT ALL ON SCHEMA public TO langgraph_user;

# Exit
\q
```

### 3. Connection Testing

```bash
# Test connection
psql -U langgraph_user -d langgraph_db -h localhost

# If successful, you'll see the PostgreSQL prompt
# Test basic operations
SELECT version();
SELECT current_database();
SELECT current_user;

# Exit
\q
```

## Application Configuration

### 1. Basic Configuration File

Create `config.py`:

```python
import os
from typing import Optional

class DatabaseConfig:
    """Database configuration for LangGraph PostgreSQL integration."""
    
    def __init__(self):
        self.uri = os.getenv("POSTGRES_URI")
        self.aes_key = os.getenv("LANGGRAPH_AES_KEY")
        self.log_level = os.getenv("LANGGRAPH_LOG_LEVEL", "INFO")
        self.environment = os.getenv("LANGGRAPH_ENVIRONMENT", "development")
    
    @property
    def connection_string(self) -> str:
        """Get the database connection string."""
        if not self.uri:
            raise ValueError("POSTGRES_URI environment variable not set")
        return self.uri
    
    @property
    def is_encrypted(self) -> bool:
        """Check if encryption is enabled."""
        return bool(self.aes_key)
    
    @property
    def is_production(self) -> bool:
        """Check if running in production environment."""
        return self.environment.lower() == "production"

# Global configuration instance
db_config = DatabaseConfig()
```

### 2. Database Connection Manager

Create `database.py`:

```python
import logging
from contextlib import contextmanager
from typing import Generator

from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.store.postgres import PostgresStore
from langgraph.checkpoint.serde.encrypted import EncryptedSerializer

from config import db_config

logger = logging.getLogger(__name__)

class DatabaseManager:
    """Manages PostgreSQL connections for LangGraph."""
    
    def __init__(self):
        self.uri = db_config.connection_string
        self.serde = self._create_serializer()
    
    def _create_serializer(self):
        """Create serializer with optional encryption."""
        if db_config.is_encrypted:
            try:
                return EncryptedSerializer.from_pycryptodome_aes()
            except Exception as e:
                logger.warning(f"Failed to create encrypted serializer: {e}")
                return None
        return None
    
    @contextmanager
    def get_checkpointer(self) -> Generator[PostgresSaver, None, None]:
        """Get PostgreSQL checkpointer with context management."""
        try:
            with PostgresSaver.from_conn_string(self.uri, serde=self.serde) as checkpointer:
                checkpointer.setup()
                logger.info("PostgreSQL checkpointer initialized successfully")
                yield checkpointer
        except Exception as e:
            logger.error(f"Failed to initialize checkpointer: {e}")
            raise
    
    @contextmanager
    def get_store(self) -> Generator[PostgresStore, None, None]:
        """Get PostgreSQL store with context management."""
        try:
            with PostgresStore.from_conn_string(self.uri) as store:
                store.setup()
                logger.info("PostgreSQL store initialized successfully")
                yield store
        except Exception as e:
            logger.error(f"Failed to initialize store: {e}")
            raise
    
    async def get_async_checkpointer(self) -> AsyncPostgresSaver:
        """Get async PostgreSQL checkpointer."""
        try:
            checkpointer = AsyncPostgresSaver.from_conn_string(self.uri, serde=self.serde)
            await checkpointer.asetup()
            logger.info("Async PostgreSQL checkpointer initialized successfully")
            return checkpointer
        except Exception as e:
            logger.error(f"Failed to initialize async checkpointer: {e}")
            raise

# Global database manager instance
db_manager = DatabaseManager()
```

### 3. Application Factory

Create `app_factory.py`:

```python
from langgraph.graph import StateGraph
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.store.postgres import PostgresStore

from database import db_manager

def create_langgraph_app(state_class, nodes, edges):
    """Create a LangGraph application with PostgreSQL persistence."""
    
    # Build the graph
    builder = StateGraph(state_class)
    
    # Add nodes
    for node_name, node_func in nodes.items():
        builder.add_node(node_name, node_func)
    
    # Add edges
    for edge in edges:
        if len(edge) == 2:
            builder.add_edge(edge[0], edge[1])
        elif len(edge) == 3:
            builder.add_conditional_edges(edge[0], edge[1], edge[2])
    
    # Compile with PostgreSQL persistence
    with db_manager.get_checkpointer() as checkpointer, \
         db_manager.get_store() as store:
        
        graph = builder.compile(checkpointer=checkpointer, store=store)
        return graph

def create_checkpointer_only_app(state_class, nodes, edges):
    """Create a LangGraph application with only checkpoint persistence."""
    
    builder = StateGraph(state_class)
    
    for node_name, node_func in nodes.items():
        builder.add_node(node_name, node_func)
    
    for edge in edges:
        if len(edge) == 2:
            builder.add_edge(edge[0], edge[1])
        elif len(edge) == 3:
            builder.add_conditional_edges(edge[0], edge[1], edge[2])
    
    with db_manager.get_checkpointer() as checkpointer:
        graph = builder.compile(checkpointer=checkpointer)
        return graph
```

## Docker Setup

### 1. Docker Compose Configuration

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    container_name: langgraph-postgres
    environment:
      POSTGRES_DB: langgraph_db
      POSTGRES_USER: langgraph_user
      POSTGRES_PASSWORD: your_secure_password
      POSTGRES_INITDB_ARGS: "--encoding=UTF-8 --lc-collate=C --lc-ctype=C"
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    networks:
      - langgraph-network
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: langgraph-redis
    ports:
      - "6379:6379"
    networks:
      - langgraph-network
    restart: unless-stopped

  langgraph-app:
    build: .
    container_name: langgraph-app
    environment:
      - POSTGRES_URI=postgresql://langgraph_user:your_secure_password@postgres:5432/langgraph_db?sslmode=disable
      - REDIS_URI=redis://redis:6379
      - LANGGRAPH_LOG_LEVEL=INFO
    depends_on:
      - postgres
      - redis
    networks:
      - langgraph-network
    restart: unless-stopped
    volumes:
      - ./app:/app
      - ./logs:/app/logs

volumes:
  postgres_data:

networks:
  langgraph-network:
    driver: bridge
```

### 2. Database Initialization Script

Create `init.sql`:

```sql
-- Initialize database for LangGraph
-- This script runs when the PostgreSQL container starts

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create custom functions if needed
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO langgraph_user;
GRANT CREATE ON SCHEMA public TO langgraph_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO langgraph_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO langgraph_user;
```

### 3. Dockerfile

Create `Dockerfile`:

```dockerfile
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create logs directory
RUN mkdir -p logs

# Expose port (if your app needs it)
EXPOSE 8000

# Run the application
CMD ["python", "main.py"]
```

## Production Deployment

### 1. Environment Configuration

```bash
# Production environment variables
export LANGGRAPH_ENVIRONMENT=production
export POSTGRES_URI=postgresql://prod_user:secure_prod_password@prod-db.example.com:5432/langgraph_prod?sslmode=require
export LANGGRAPH_AES_KEY=your_32_character_production_aes_key
export LANGGRAPH_LOG_LEVEL=WARNING
export POSTGRES_POOL_SIZE=20
export POSTGRES_MAX_OVERFLOW=30
```

### 2. Production Database Setup

```sql
-- Production database setup
CREATE DATABASE langgraph_prod;

-- Create production user with limited privileges
CREATE USER langgraph_prod_user WITH PASSWORD 'secure_production_password';

-- Grant minimal required privileges
GRANT CONNECT ON DATABASE langgraph_prod TO langgraph_prod_user;
GRANT USAGE ON SCHEMA public TO langgraph_prod_user;
GRANT CREATE ON SCHEMA public TO langgraph_prod_user;

-- Create tables (LangGraph will handle this automatically)
-- But you can pre-create them for performance

-- Set up connection pooling
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';

-- Reload configuration
SELECT pg_reload_conf();
```

### 3. Load Balancer Configuration

```nginx
# Nginx configuration for load balancing
upstream langgraph_backend {
    server 127.0.0.1:8001;
    server 127.0.0.1:8002;
    server 127.0.0.1:8003;
}

server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://langgraph_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Monitoring and Maintenance

### 1. Health Check Script

Create `health_check.py`:

```python
#!/usr/bin/env python3
"""Health check script for PostgreSQL LangGraph integration."""

import sys
import logging
from database import db_manager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def check_database_health():
    """Check database connectivity and basic operations."""
    try:
        with db_manager.get_checkpointer() as checkpointer:
            # Test basic operations
            config = {"configurable": {"thread_id": "health_check"}}
            checkpoints = list(checkpointer.list(config))
            
            logger.info(f"Database health check passed: {len(checkpoints)} checkpoints found")
            return True
            
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        return False

def main():
    """Main health check function."""
    if check_database_health():
        logger.info("✅ All systems operational")
        sys.exit(0)
    else:
        logger.error("❌ Health check failed")
        sys.exit(1)

if __name__ == "__main__":
    main()
```

### 2. Backup Script

Create `backup.py`:

```python
#!/usr/bin/env python3
"""Backup script for PostgreSQL LangGraph data."""

import os
import subprocess
import datetime
from pathlib import Path

def create_backup():
    """Create a backup of the PostgreSQL database."""
    
    # Configuration
    db_uri = os.getenv("POSTGRES_URI")
    backup_dir = Path("backups")
    backup_dir.mkdir(exist_ok=True)
    
    # Parse connection string
    # postgresql://user:pass@host:port/db
    parts = db_uri.replace("postgresql://", "").split("@")
    credentials = parts[0].split(":")
    host_port_db = parts[1].split("/")
    
    user = credentials[0]
    password = credentials[1]
    host_port = host_port_db[0].split(":")
    host = host_port[0]
    port = host_port[1] if len(host_port) > 1 else "5432"
    database = host_port_db[1].split("?")[0]
    
    # Create backup filename
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = backup_dir / f"langgraph_backup_{timestamp}.sql"
    
    # Set environment variable for password
    env = os.environ.copy()
    env["PGPASSWORD"] = password
    
    try:
        # Create backup using pg_dump
        cmd = [
            "pg_dump",
            "-h", host,
            "-p", port,
            "-U", user,
            "-d", database,
            "-f", str(backup_file),
            "--verbose"
        ]
        
        result = subprocess.run(cmd, env=env, capture_output=True, text=True)
        
        if result.returncode == 0:
            print(f"✅ Backup created successfully: {backup_file}")
            return str(backup_file)
        else:
            print(f"❌ Backup failed: {result.stderr}")
            return None
            
    except Exception as e:
        print(f"❌ Backup error: {e}")
        return None

if __name__ == "__main__":
    backup_file = create_backup()
    if backup_file:
        print(f"Backup completed: {backup_file}")
    else:
        print("Backup failed")
```

### 3. Monitoring Queries

```sql
-- Monitor checkpoint growth
SELECT 
    DATE(ts) as date,
    COUNT(*) as checkpoints,
    AVG(LENGTH(channel_values::text)) as avg_size_bytes
FROM langgraph_checkpoints 
WHERE ts >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY DATE(ts)
ORDER BY date;

-- Monitor active threads
SELECT 
    thread_id,
    COUNT(*) as checkpoint_count,
    MAX(ts) as last_activity
FROM langgraph_checkpoints 
GROUP BY thread_id
HAVING MAX(ts) >= CURRENT_TIMESTAMP - INTERVAL '1 hour'
ORDER BY last_activity DESC;

-- Check database size
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

## Troubleshooting

### Common Issues and Solutions

#### 1. Connection Refused

```bash
# Check if PostgreSQL is running
sudo systemctl status postgresql

# Check if port is listening
sudo netstat -tlnp | grep 5432

# Check firewall settings
sudo ufw status
```

#### 2. Authentication Failed

```bash
# Check PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-*.log

# Verify user exists
sudo -u postgres psql -c "\du"

# Reset password if needed
sudo -u postgres psql -c "ALTER USER langgraph_user PASSWORD 'new_password';"
```

#### 3. Permission Denied

```sql
-- Grant necessary permissions
GRANT ALL PRIVILEGES ON DATABASE langgraph_db TO langgraph_user;
GRANT ALL ON SCHEMA public TO langgraph_user;
GRANT CREATE ON SCHEMA public TO langgraph_user;
```

#### 4. Table Creation Failed

```sql
-- Check if tables exist
\dt

-- Check user permissions
SELECT grantee, privilege_type, table_name 
FROM information_schema.role_table_grants 
WHERE grantee = 'langgraph_user';
```

### Performance Tuning

```sql
-- Optimize PostgreSQL for LangGraph
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';

-- Create indexes for better performance
CREATE INDEX CONCURRENTLY idx_langgraph_checkpoints_thread_id 
ON langgraph_checkpoints(thread_id);

CREATE INDEX CONCURRENTLY idx_langgraph_checkpoints_ts 
ON langgraph_checkpoints(ts);

-- Reload configuration
SELECT pg_reload_conf();
```

### Log Analysis

```bash
# Enable detailed logging
echo "log_statement = 'all'" | sudo tee -a /etc/postgresql/*/main/postgresql.conf
echo "log_min_duration_statement = 1000" | sudo tee -a /etc/postgresql/*/main/postgresql.conf

# Restart PostgreSQL
sudo systemctl restart postgresql

# Monitor slow queries
sudo tail -f /var/log/postgresql/postgresql-*.log | grep "duration:"
```

## Conclusion

This setup guide provides a comprehensive foundation for implementing PostgreSQL as a checkpoint saver and store backend for LangGraph applications. By following these steps, you can establish a robust, scalable, and production-ready persistence layer for your LangGraph workflows.

Remember to:
- Always test in a development environment first
- Monitor performance and adjust configurations accordingly
- Implement proper backup and recovery procedures
- Keep your dependencies and PostgreSQL version up to date
- Document any custom configurations for your team

For additional support, refer to:
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [psycopg Documentation](https://www.psycopg.org/docs/)
