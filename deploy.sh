#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

# Define deployment targets
PROJECT_ID="our-metric-501215-n6"
REGION="us-central1"
REPO_NAME="ce-sample-hr-vacation-repo"
IMAGE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/app:latest"

echo "=========================================================="
echo " Starting GCP HR Subsystem Classroom Application Deployment "
echo "=========================================================="
echo "Project ID:  $PROJECT_ID"
echo "Region:      $REGION"
echo "Repository:  $REPO_NAME"
echo "=========================================================="

# 1. Enforce GCP Project configuration
echo "Setting active gcloud project context to $PROJECT_ID..."
gcloud config set project "$PROJECT_ID"

# 2. Enable Required APIs
echo "Enabling Google Cloud Service APIs (this might take a moment)..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  iap.googleapis.com

# 3. Create Artifact Registry if not exists
echo "Checking if Artifact Registry repository exists..."
if gcloud artifacts repositories describe "$REPO_NAME" --location="$REGION" &>/dev/null; then
  echo "Repository $REPO_NAME already exists in region $REGION."
else
  echo "Repository $REPO_NAME not found. Creating a new Docker registry..."
  gcloud artifacts repositories create "$REPO_NAME" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Classroom HR Vacation Application Registry"
fi

# 4. Build Container Image using Cloud Build
echo "Submitting application source to Cloud Build..."
gcloud builds submit --tag "$IMAGE_TAG" .

# 5. Deploy to Cloud Run (Ingress Restricted to Internal and Load Balancing)
echo "Deploying the containerized application to Cloud Run with Restricted Ingress..."
gcloud run deploy ce-sample-hr-vacation \
  --image "$IMAGE_TAG" \
  --platform managed \
  --region "$REGION" \
  --ingress internal-and-cloud-load-balancing \
  --allow-unauthenticated

echo ""
echo "=========================================================="
echo " 🎉 Deployment and Security Configuration Complete!"
echo "=========================================================="
echo "Cloud Run Ingress Status: [INTERNAL & LOAD BALANCING ONLY]"
echo "This service cannot be accessed directly via its public .run.app URL anymore."
echo ""
echo "👉 NEXT STEPS FOR SECURITY HANDS-ON LAB:"
echo "1. Go to the Cloud Console -> Network Services -> Load Balancing."
echo "2. Create/Inspect the Global External HTTP(S) Load Balancer."
echo "3. Go to Security -> Identity-Aware Proxy."
echo "4. Under 'HTTPS Resources' find your load balancer backend service."
echo "5. Toggle the IAP switch to 'Enabled' and add your students' accounts"
echo "   with the 'IAP-secured Web App User' role."
echo "=========================================================="

