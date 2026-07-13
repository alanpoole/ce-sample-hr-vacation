#!/bin/bash

# Ensure local workspace binaries are in the path (e.g. locally downloaded Terraform)
export PATH="$PATH:$(pwd)/.bin"
export CLOUDSDK_CORE_DISABLE_PROMPTS=1
export GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token)

# Exit immediately if any command exits with a non-zero status
set -e

# Setup clean log styling
BOLD='\033[1;32m'
NC='\033[0m' # No Color
INFO='\033[1;34m'
WARN='\033[1;33m'

echo -e "${BOLD}===================================================================${NC}"
echo -e "${BOLD}   GCP Project Bootstrap & Multi-Region Break-Fix Lab Deployment   ${NC}"
echo -e "${BOLD}===================================================================${NC}"

# Check for required parameters
if [ "$#" -lt 2 ]; then
  echo -e "${WARN}Usage: $0 <PROJECT_ID> <BILLING_ACCOUNT_ID> [PRIMARY_REGION] [SECONDARY_REGION]${NC}"
  echo ""
  echo "Arguments:"
  echo "  PROJECT_ID          The unique ID of the GCP project (e.g. hr-vacation-lab-123)"
  echo "  BILLING_ACCOUNT_ID  Your billing account ID to link (e.g. 012345-6789AB-CDEF01)"
  echo "  PRIMARY_REGION      (Optional) Primary deployment region. Defaults to us-central1"
  echo "  SECONDARY_REGION    (Optional) Secondary deployment region. Defaults to europe-west1"
  echo ""
  exit 1
fi

PROJECT_ID="$1"
BILLING_ACCOUNT_ID="$2"
PRIMARY_REGION="${3:-us-central1}"
SECONDARY_REGION="${4:-europe-west1}"
REPO_NAME="ce-sample-hr-vacation-repo"

echo -e "${INFO}[1/7] Initializing GCP Configuration...${NC}"
# Check if user is logged into gcloud
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q "@"; then
  echo "Error: You do not appear to be logged in to gcloud. Please run 'gcloud auth login' first."
  exit 1
fi

# Create project if it doesn't exist
echo "Checking if project $PROJECT_ID exists..."
if gcloud projects describe "$PROJECT_ID" &>/dev/null; then
  echo "Project $PROJECT_ID already exists. Using existing project."
else
  echo "Creating new GCP project: $PROJECT_ID..."
  gcloud projects create "$PROJECT_ID" --name="AlloyDB HR Vacation Lab"
fi

# Link project to billing
echo "Linking project $PROJECT_ID to billing account $BILLING_ACCOUNT_ID..."
gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT_ID"

# Set current project context
echo "Setting gcloud project context to $PROJECT_ID..."
gcloud config set project "$PROJECT_ID"

echo -e "${INFO}[2/7] Enabling Required Google APIs (this can take up to 2-3 minutes)...${NC}"
gcloud services enable \
  compute.googleapis.com \
  servicenetworking.googleapis.com \
  vpcaccess.googleapis.com \
  alloydb.googleapis.com \
  redis.googleapis.com \
  dns.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  iap.googleapis.com

echo -e "${INFO}[3/7] Generating Terraform tfvars File...${NC}"
ACTIVE_ACCOUNT=$(gcloud config get-value account)
cat <<EOF > terraform/terraform.tfvars
project_id    = "$PROJECT_ID"
region        = "$PRIMARY_REGION"
zone          = "${PRIMARY_REGION}-a"
support_email = "$ACTIVE_ACCOUNT"
iap_user      = "$ACTIVE_ACCOUNT"
EOF
echo "Variables written to terraform/terraform.tfvars"

echo -e "${INFO}[4/7] Bootstrapping Build Infrastructure and IAM Roles via Terraform...${NC}"
cd terraform
terraform init -upgrade
terraform import google_storage_bucket.gcs-cloud-build "${PROJECT_ID}_cloudbuild" || true
terraform import google_artifact_registry_repository.app_repo "projects/${PROJECT_ID}/locations/${PRIMARY_REGION}/repositories/${REPO_NAME}" || true
terraform apply -auto-approve \
  -target=google_artifact_registry_repository.app_repo \
  -target=google_storage_bucket.gcs-cloud-build \
  -target=google_project_iam_member.compute_storage_admin \
  -target=google_project_iam_member.compute_log_writer \
  -target=google_project_iam_member.compute_artifact_writer
cd ..

echo -e "${INFO}[5/7] Submitting Monolithic App Image Build (v2.0-break-fix) to Google Cloud Build...${NC}"
gcloud builds submit --tag "${PRIMARY_REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/app:latest" .

echo -e "${INFO}[6/7] Deploying Application & Services via Terraform...${NC}"
cd terraform
terraform apply -auto-approve
cd ..

echo -e "${BOLD}===================================================================${NC}"
echo -e "${BOLD} 🎉 Multi-Region Break-Fix Lab Deployed Successfully!              ${NC}"
echo -e "${BOLD}===================================================================${NC}"
echo "Project ID:        $PROJECT_ID"
echo "Primary Region:    $PRIMARY_REGION (Cloud Run: hr-vacation-app)"
echo "Secondary Region:  $SECONDARY_REGION (Cloud Run: hr-vacation-app-europe)"
echo ""
LB_IP=$(cd terraform && terraform output -raw load_balancer_ip)
LB_DOMAIN="hr-vacation.${LB_IP}.nip.io"
echo -e "Load Balancer IP:  \033]8;;https://${LB_DOMAIN}\033\\${LB_IP}\033]8;;\033\\"
echo "Load Balancer URL: https://${LB_DOMAIN}"
echo "==================================================================="
