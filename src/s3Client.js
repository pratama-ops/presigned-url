import { S3Client } from "@aws-sdk/client-s3";

export const s3Client = new S3Client({
  // minIO run locally, so this endpoint must be declare manually
  endpoint: "http://localhost:9000",
  region: "us-east-1", // This section must be filled out
  credentials: { // the same as the password and username in Docker Compose
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
  },
  forcePathStyle: true, // must be set to true
});

// same bucket name that we make at minIO
export const BUCKET_NAME = "presigned-demo-bucket";