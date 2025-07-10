#!/bin/bash

# Logto Development Setup Script

set -e

echo "🚀 Starting Logto Development Environment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    print_error "Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Stop any existing containers
print_status "Stopping existing containers..."
docker-compose -f docker-compose.dev.yml down

# Build and start the services
print_status "Building and starting services..."
docker-compose -f docker-compose.dev.yml up --build -d postgres redis

# Wait for database to be ready
print_status "Waiting for database to be ready..."
sleep 10

# Run database initialization
print_status "Initializing database..."
docker-compose -f docker-compose.dev.yml run --rm db-init

# Start the main application
print_status "Starting Logto application..."
docker-compose -f docker-compose.dev.yml up --build logto-core

print_status "Development environment setup complete!"
echo ""
echo "📋 Services:"
echo "  - Admin Console: http://localhost:3002"
echo "  - Core API: http://localhost:3001"
echo "  - PostgreSQL: localhost:5432"
echo "  - Redis: localhost:6379"
echo ""
echo "🛠️  To stop the environment:"
echo "  docker-compose -f docker-compose.dev.yml down"
echo ""
echo "📊 To view logs:"
echo "  docker-compose -f docker-compose.dev.yml logs -f logto-core"
echo ""
echo "🔧 To access the container:"
echo "  docker exec -it logto-core-dev sh" 