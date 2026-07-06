# Copyright 2023 Google LLC All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

###############################
##### 1) SERVICE ACCOUNTS #####
###############################

data "google_compute_default_service_account" "default" {
}

###############################
###### 1) MEMBER BINDINGS #####
###############################

# GCS Identity
resource "google_service_account_iam_binding" "sa_gcs_object_write" {
  service_account_id = data.google_compute_default_service_account.default.name
  role               = "roles/storage.objectViewer"
  members = [
    "serviceAccount:${data.google_compute_default_service_account.default.email}",
  ]
  depends_on = [
    resource.google_storage_bucket.gcs-cloud-build,
  
  ]
}