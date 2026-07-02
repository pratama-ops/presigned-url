import http from "node:http";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client, BUCKET_NAME } from "./s3Client.js";
import { randomUUID } from "node:crypto";

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/uploads/request-url") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { fileName, contentType } = JSON.parse(body);

        // key = A unique path within the bucket to avoid file collisions
        const key = `uploads/${randomUUID()}-${fileName}`;

        // instructions regarding the operation to be performed on S3/MinIO
        const command = new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
          ContentType: contentType,
        });

        const uploadUrl = await getSignedUrl(s3Client, command, {
          expiresIn: 300, // 5 minute
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ uploadUrl, key }));
      } catch (err) {
        console.error(err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Gagal generate presigned URL" }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(3000, () => {
  console.log("Server jalan di http://localhost:3000");
});