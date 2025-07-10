# Logto Development Setup

This guide helps you set up Logto for local development with Docker, including database setup and hot reload.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)

## Quick Start

### 1. Clone and Setup

```bash
git clone <your-repo>
cd logto
```

### 2. Start Development Environment

#### Option A: Using the setup script (Linux/Mac)
```bash
./dev-setup.sh
```

#### Option B: Manual setup (Windows/Linux/Mac)
```bash
# Start database and Redis
docker-compose -f docker-compose.dev.yml up -d postgres redis

# Wait for database to be ready (about 10 seconds)
sleep 10

# Initialize database
docker-compose -f docker-compose.dev.yml run --rm db-init

# Start Logto application
docker-compose -f docker-compose.dev.yml up --build logto-core
```

### 3. Access the Application

- **Admin Console**: http://localhost:3002
- **Core API**: http://localhost:3001
- **API Documentation**: http://localhost:3001/api/swagger.json

## Development Features

### ✅ What's Enabled in Local Development

- **Tenant Management APIs**: Full CRUD operations for tenants
- **No Dev/Prod Restrictions**: All features available without subscription limits
- **No Region Selection**: Uses default region for local development
- **Hot Reload**: Code changes automatically restart services
- **Admin Permissions**: Full tenant management rights for admin user
- **Database Setup**: Automatic database initialization and migrations

### 🔧 Environment Configuration

The development environment uses these key settings:

```env
IS_CLOUD=false
NODE_ENV=development
DEV_FEATURES_ENABLED=true
DB_URL=postgresql://logto:logto_password@postgres:5432/logto
REDIS_URL=redis://redis:6379
```

## API Endpoints

### Tenant Management (Local Only)

```bash
# List all tenants
GET /api/tenants

# Create a new tenant
POST /api/tenants
{
  "name": "My Tenant",
  "tag": "Development"
}

# Get tenant by ID
GET /api/tenants/{id}

# Update tenant
PATCH /api/tenants/{id}
{
  "name": "Updated Name"
}

# Delete tenant
DELETE /api/tenants/{id}
```

## Development Commands

### Docker Commands

```bash
# View logs
docker-compose -f docker-compose.dev.yml logs -f logto-core

# Stop all services
docker-compose -f docker-compose.dev.yml down

# Rebuild and restart
docker-compose -f docker-compose.dev.yml up --build logto-core

# Access container shell
docker exec -it logto-core-dev sh

# Reset database (remove all data)
docker-compose -f docker-compose.dev.yml down -v
```

### Database Commands

```bash
# Run database migrations
docker-compose -f docker-compose.dev.yml run --rm db-init

# Access database directly
docker exec -it logto-postgres-dev psql -U logto -d logto
```

## File Structure

```
logto/
├── Dockerfile.dev              # Development Docker image
├── docker-compose.dev.yml      # Development services
├── dev-setup.sh               # Setup script (Linux/Mac)
├── packages/
│   ├── core/                  # Core API with tenant routes
│   ├── console/               # Admin console
│   └── ...
└── DEV-SETUP.md              # This file
```

## Troubleshooting

### Common Issues

1. **Port already in use**
   ```bash
   # Stop existing services
   docker-compose -f docker-compose.dev.yml down
   
   # Check what's using the port
   netstat -tulpn | grep :3001
   ```

2. **Database connection issues**
   ```bash
   # Check database health
   docker-compose -f docker-compose.dev.yml ps postgres
   
   # View database logs
   docker-compose -f docker-compose.dev.yml logs postgres
   ```

3. **Build failures**
   ```bash
   # Clean build
   docker-compose -f docker-compose.dev.yml down
   docker system prune -f
   docker-compose -f docker-compose.dev.yml up --build
   ```

### Logs and Debugging

```bash
# View all service logs
docker-compose -f docker-compose.dev.yml logs -f

# View specific service logs
docker-compose -f docker-compose.dev.yml logs -f logto-core
docker-compose -f docker-compose.dev.yml logs -f postgres
```

## Production Deployment

This setup is for development only. For production:

1. Use proper environment variables
2. Use production database credentials
3. Enable HTTPS
4. Configure proper CORS settings
5. Use production-ready Docker images

## Contributing

1. Make your changes
2. Test in the development environment
3. Submit a pull request

## Support

If you encounter issues:

1. Check the troubleshooting section
2. View container logs
3. Check Docker and Docker Compose versions
4. Open an issue with detailed error messages 