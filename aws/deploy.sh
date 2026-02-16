#!/bin/bash
# Game On Dude! - AWS Deployment Script
# www.gameonguy.com

set -e

# Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
ENVIRONMENT="${ENVIRONMENT:-production}"
ECR_REPO="gameondude"
CLUSTER_NAME="gameondude-cluster-${ENVIRONMENT}"
SERVICE_NAME="gameondude-service-${ENVIRONMENT}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

echo "====================================="
echo "Game On Dude! Server Deployment"
echo "====================================="
echo "Region: ${AWS_REGION}"
echo "Account: ${AWS_ACCOUNT_ID}"
echo "Environment: ${ENVIRONMENT}"
echo "Image Tag: ${IMAGE_TAG}"
echo "====================================="

# Step 1: Login to ECR
echo "Logging in to ECR..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

# Step 2: Build Docker image
echo "Building Docker image..."
docker build -t ${ECR_REPO}:${IMAGE_TAG} .

# Step 3: Tag image for ECR
echo "Tagging image for ECR..."
docker tag ${ECR_REPO}:${IMAGE_TAG} ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:${IMAGE_TAG}

# Step 4: Push to ECR
echo "Pushing image to ECR..."
docker push ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:${IMAGE_TAG}

# Step 5: Update ECS service
echo "Updating ECS service..."
aws ecs update-service \
    --cluster ${CLUSTER_NAME} \
    --service ${SERVICE_NAME} \
    --force-new-deployment \
    --region ${AWS_REGION}

# Step 6: Wait for deployment
echo "Waiting for deployment to complete..."
aws ecs wait services-stable \
    --cluster ${CLUSTER_NAME} \
    --services ${SERVICE_NAME} \
    --region ${AWS_REGION}

echo "====================================="
echo "Deployment complete!"
echo "====================================="

# Get the ALB DNS name
ALB_DNS=$(aws cloudformation describe-stacks \
    --stack-name gameondude-${ENVIRONMENT} \
    --query 'Stacks[0].Outputs[?OutputKey==`ALBDNSName`].OutputValue' \
    --output text \
    --region ${AWS_REGION} 2>/dev/null || echo "Unknown")

echo "Server URL: ws://${ALB_DNS}/ws"
echo "Admin URL: http://${ALB_DNS}:3001"
