# Game On Dude! - AWS Deployment Guide

**Website**: [www.gameonguy.com](https://www.gameonguy.com)

This guide walks you through deploying the Game On Dude! server to AWS using Elastic Beanstalk with RDS PostgreSQL and ElastiCache Redis.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AWS CLOUD                                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐     ┌──────────────────────────────────────────┐ │
│  │  AWS Amplify     │     │        Elastic Beanstalk                  │ │
│  │  (Marketing Site)│     │  ┌──────────────────────────────────────┐│ │
│  │  Next.js         │     │  │  Application Load Balancer (ALB)     ││ │
│  │  gameonguy.com   │     │  │  - WebSocket support                 ││ │
│  └──────────────────┘     │  │  - SSL/TLS termination               ││ │
│                           │  └────────────────┬─────────────────────┘│ │
│                           │                   │                       │ │
│                           │  ┌────────────────┴─────────────────────┐│ │
│                           │  │  EC2 Instances (Auto Scaling)        ││ │
│                           │  │  - Node.js 20                        ││ │
│                           │  │  - Game On Dude! Server              ││ │
│                           │  │  - Port 3000 (WebSocket)             ││ │
│                           │  │  - Port 3001 (Admin API)             ││ │
│                           │  └────────────────┬─────────────────────┘│ │
│                           └───────────────────┼──────────────────────┘ │
│                                               │                         │
│  ┌────────────────────────────────────────────┼────────────────────────┐│
│  │                    Private Subnets         │                        ││
│  │                                            │                        ││
│  │  ┌─────────────────────┐    ┌─────────────┴───────────┐            ││
│  │  │  RDS PostgreSQL     │    │  ElastiCache Redis      │            ││
│  │  │  - User data        │    │  - Sessions             │            ││
│  │  │  - Match history    │    │  - Pub/Sub              │            ││
│  │  │  - Leaderboards     │    │  - Room sync            │            ││
│  │  └─────────────────────┘    └─────────────────────────┘            ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

1. **AWS Account** with admin access
2. **AWS CLI** installed and configured
3. **EB CLI** installed (`pip install awsebcli`)
4. **Node.js 18+** installed locally

### Install AWS CLI
```bash
# Windows (PowerShell)
msiexec.exe /i https://awscli.amazonaws.com/AWSCLIV2.msi

# macOS
brew install awscli

# Configure
aws configure
```

### Install EB CLI
```bash
pip install awsebcli --upgrade
```

---

## Step 1: Deploy Database Infrastructure

First, deploy RDS PostgreSQL and ElastiCache Redis using CloudFormation.

### Option A: Using AWS Console

1. Go to **CloudFormation** → **Create stack**
2. Upload `aws/cloudformation-database.yaml`
3. Fill in parameters:
   - **Environment**: `production`
   - **VpcId**: Your VPC ID
   - **SubnetIds**: At least 2 private subnet IDs
   - **EBSecurityGroupId**: (Create EB first, then update)
   - **DBInstanceClass**: `db.t3.micro` (or larger)
   - **CacheNodeType**: `cache.t3.micro`
4. Create stack and wait ~15 minutes

### Option B: Using AWS CLI

```bash
aws cloudformation create-stack \
  --stack-name gameondude-database \
  --template-body file://aws/cloudformation-database.yaml \
  --parameters \
    ParameterKey=Environment,ParameterValue=production \
    ParameterKey=VpcId,ParameterValue=vpc-xxxxxxxxx \
    ParameterKey=SubnetIds,ParameterValue="subnet-xxx,subnet-yyy" \
    ParameterKey=EBSecurityGroupId,ParameterValue=sg-xxxxxxxxx \
  --capabilities CAPABILITY_IAM
```

### Get Database Credentials

The RDS password is stored in AWS Secrets Manager:

```bash
# Get the secret ARN from CloudFormation outputs
aws cloudformation describe-stacks \
  --stack-name gameondude-database \
  --query "Stacks[0].Outputs"

# Retrieve the password
aws secretsmanager get-secret-value \
  --secret-id <secret-arn> \
  --query SecretString
```

---

## Step 2: Deploy Game Server to Elastic Beanstalk

### Initialize EB Application

```bash
cd "C:\Users\edwar\Documents\Business\Xogos Gaming\0. Xogos Code\9. Multiplayer Server Services"

# Initialize (first time only)
eb init gameondude-server --region us-east-1 --platform "Node.js 20"
```

### Create Environment

```bash
# Create production environment
eb create gameondude-production \
  --elb-type application \
  --instance-type t3.small \
  --vpc.id vpc-xxxxxxxxx \
  --vpc.elbsubnets subnet-public1,subnet-public2 \
  --vpc.ec2subnets subnet-private1,subnet-private2
```

### Set Environment Variables

After getting database endpoints from CloudFormation:

```bash
eb setenv \
  NODE_ENV=production \
  PORT=3000 \
  ADMIN_PORT=3001 \
  DATABASE_URL="postgresql://gameondude:PASSWORD@ENDPOINT:5432/gameondude" \
  REDIS_URL="redis://REDIS_ENDPOINT:6379" \
  JWT_SECRET="your-secure-secret-here" \
  WS_PATH="/ws"
```

**IMPORTANT**: Replace:
- `PASSWORD` with the RDS password from Secrets Manager
- `ENDPOINT` with the RDS endpoint
- `REDIS_ENDPOINT` with the ElastiCache endpoint
- `your-secure-secret-here` with a secure random string

### Deploy

```bash
eb deploy
```

---

## Step 3: Configure Security Groups

After creating the EB environment, update the database CloudFormation stack with the EB security group:

1. Go to **EC2** → **Security Groups**
2. Find the security group for your EB environment (named like `awseb-...`)
3. Copy the security group ID
4. Update the CloudFormation stack with this security group ID

---

## Step 4: Initialize Database Schema

Connect to your RDS instance and run the init script:

```bash
# Use a bastion host or VPN to connect
psql -h ENDPOINT -U gameondude -d gameondude -f db/init.sql
```

Or from an EC2 instance in the same VPC:

```bash
eb ssh
psql -h $DATABASE_HOST -U gameondude -d gameondude -f /var/app/current/db/init.sql
```

---

## Step 5: Enable HTTPS (Recommended)

1. **Request SSL Certificate** in AWS Certificate Manager:
   - Go to **ACM** → **Request certificate**
   - Enter your domain: `api.gameonguy.com` (or similar)
   - Use DNS validation
   - Add the CNAME record to your DNS

2. **Update Elastic Beanstalk**:
   - Edit `.ebextensions/03-https.config`
   - Uncomment the HTTPS section
   - Replace `YOUR_CERTIFICATE_ARN` with your certificate ARN
   - Deploy: `eb deploy`

---

## Step 6: Configure DNS

Point your domain to the Elastic Beanstalk URL:

1. Get EB URL: `eb status` (look for "CNAME")
2. In your DNS provider, create a CNAME record:
   - **Name**: `api` (for api.gameonguy.com)
   - **Value**: `gameondude-production.us-east-1.elasticbeanstalk.com`

---

## Deployment Commands Reference

```bash
# View status
eb status

# View logs
eb logs

# SSH into instance
eb ssh

# Open in browser
eb open

# Deploy updates
eb deploy

# View environment variables
eb printenv

# Scale up
eb scale 3

# Terminate (WARNING: destroys everything)
eb terminate
```

---

## Monitoring

### CloudWatch Metrics
- Go to **CloudWatch** → **Metrics** → **ElasticBeanstalk**
- Monitor: CPU, Memory, Request count, Latency

### Application Logs
```bash
eb logs --all
```

### Health Dashboard
```bash
eb health
```

---

## Troubleshooting

### Connection Refused
- Check security groups allow traffic between EB and RDS/ElastiCache
- Verify environment variables are set correctly

### WebSocket Not Working
- Ensure ALB is configured (not Classic Load Balancer)
- Check idle timeout is set to 3600 seconds
- Verify sticky sessions are enabled

### Database Connection Failed
- Verify DATABASE_URL format
- Check RDS security group allows EB security group
- Ensure RDS is in the same VPC

### Logs
```bash
# Recent logs
eb logs

# All logs
eb logs --all

# Stream logs
eb logs --stream
```

---

## Cost Estimates (Monthly)

| Resource | Type | Estimated Cost |
|----------|------|----------------|
| Elastic Beanstalk | t3.small (1 instance) | ~$15 |
| RDS PostgreSQL | db.t3.micro | ~$15 |
| ElastiCache Redis | cache.t3.micro | ~$12 |
| Application Load Balancer | - | ~$16 |
| Data Transfer | Variable | ~$5-20 |
| **Total** | | **~$65-80/month** |

For development, you can reduce costs:
- Use `db.t3.micro` and `cache.t3.micro`
- Single AZ deployment
- Turn off when not in use

---

## Next Steps

1. **Deploy Marketing Website** to AWS Amplify
2. **Set up CloudWatch Alarms** for monitoring
3. **Configure Auto Scaling** policies
4. **Enable RDS Multi-AZ** for production
5. **Set up CI/CD** with GitHub Actions

---

*Last Updated: February 2026*
*Game On Dude! - www.gameonguy.com*
