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
  artifactregistry.googleapis.com

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

# 5. Deploy to Cloud Run
echo "Deploying the containerized application to Cloud Run..."
gcloud run deploy ce-sample-hr-vacation \
  --image "$IMAGE_TAG" \
  --platform managed \
  --region "$REGION" \
  --allow-unauthenticated

echo ""
echo "=========================================================="
echo " 🎉 Deployment Complete!"
echo "=========================================================="
echo "Access the classroom portal at the URL below:"
gcloud run services describe ce-sample-hr-vacation --region "$REGION" --format='value(status.url)'
echo "=========================================================="
