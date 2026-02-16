#!/bin/bash
# Game On Dude! - Elastic Beanstalk Deployment Script
# www.gameonguy.com
#
# This script deploys the game server to AWS Elastic Beanstalk
#
# Prerequisites:
# 1. AWS CLI installed and configured: aws configure
# 2. EB CLI installed: pip install awsebcli
# 3. An existing VPC with subnets
#
# Usage: ./deploy-eb.sh [environment]
# Example: ./deploy-eb.sh production

set -e

# Configuration
APP_NAME="gameondude-server"
REGION="${AWS_REGION:-us-east-1}"
ENVIRONMENT="${1:-production}"
PLATFORM="Node.js 20"

echo "========================================"
echo "Game On Dude! - Deployment Script"
echo "========================================"
echo "Environment: $ENVIRONMENT"
echo "Region: $REGION"
echo ""

# Check for required tools
check_requirements() {
    echo "Checking requirements..."

    if ! command -v aws &> /dev/null; then
        echo "ERROR: AWS CLI is not installed"
        echo "Install: https://aws.amazon.com/cli/"
        exit 1
    fi

    if ! command -v eb &> /dev/null; then
        echo "ERROR: EB CLI is not installed"
        echo "Install: pip install awsebcli"
        exit 1
    fi

    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        echo "ERROR: AWS credentials not configured"
        echo "Run: aws configure"
        exit 1
    fi

    echo "All requirements met!"
}

# Build the project
build_project() {
    echo ""
    echo "Building project..."
    npm ci
    npm run build
    npm test
    echo "Build complete!"
}

# Initialize Elastic Beanstalk (first time only)
init_eb() {
    if [ ! -d ".elasticbeanstalk" ]; then
        echo ""
        echo "Initializing Elastic Beanstalk..."
        eb init "$APP_NAME" \
            --region "$REGION" \
            --platform "$PLATFORM"
    fi
}

# Create or update environment
deploy_eb() {
    echo ""
    echo "Deploying to Elastic Beanstalk..."

    # Check if environment exists
    if eb status "$APP_NAME-$ENVIRONMENT" &> /dev/null; then
        echo "Updating existing environment..."
        eb deploy "$APP_NAME-$ENVIRONMENT"
    else
        echo "Creating new environment..."
        eb create "$APP_NAME-$ENVIRONMENT" \
            --elb-type application \
            --instance-type t3.small \
            --envvars NODE_ENV=production,PORT=3000,ADMIN_PORT=3001
    fi
}

# Main execution
main() {
    check_requirements
    build_project
    init_eb
    deploy_eb

    echo ""
    echo "========================================"
    echo "Deployment complete!"
    echo "========================================"
    echo ""
    echo "Next steps:"
    echo "1. Set environment variables in EB Console:"
    echo "   - DATABASE_URL"
    echo "   - REDIS_URL"
    echo "   - JWT_SECRET"
    echo ""
    echo "2. Get your EB URL:"
    echo "   eb status"
    echo ""
    echo "3. View logs:"
    echo "   eb logs"
    echo ""
}

main "$@"
