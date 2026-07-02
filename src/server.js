import http from "node:http";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client, BUCKET_NAME } from "./s3Client.js";
import { randomUUID } from "node:crypto";

const uploadRecords = [];

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

                // catat record dengan status "pending" — belum tentu jadi diupload
                uploadRecords.push({
                    key,
                    fileName,
                    contentType,
                    status: "pending",
                    createdAt: new Date(),
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

    // ENDPOINT 2
    if (req.method == "POST" && req.url == "/uploads/confirm") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
            try {
                const { key } = JSON.parse(body);

                // cari record yang key-nya cocok
                const record = uploadRecords.find((r) => r.key === key);

                if (!record) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Record upload tidak ditemukan" }));
                    return;
                };

                //update status dari pending jadi confirm
                record.status = "confirmed";
                record.confirmedAt = new Date();

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ message: "Upload dikonfirmasi", record }));
            } catch (err) {
                console.error(err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Gagal konfirmasi upload" }));
            }
        });
        return;
    }

    // ENDPOINT 3: lihat semua record (buat debugging)
    if (req.method === "GET" && req.url === "/uploads") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(uploadRecords));
        return;
    }

    res.writeHead(404);
    res.end("Not Found");
});

server.listen(3000, () => {
    console.log("Server jalan di http://localhost:3000");
});