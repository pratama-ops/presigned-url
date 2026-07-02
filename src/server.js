import http from "node:http";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client, BUCKET_NAME } from "./s3Client.js";
import { randomUUID } from "node:crypto";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";

const uploadRecords = [];

const server = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/uploads/request-url") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
            try {
                const { fileName, contentType } = JSON.parse(body);

                // VALIDASI 1: fileName wajib ada dan berupa string
                if (!fileName || typeof fileName !== "string") {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "fileName wajib diisi" }));
                    return;
                }

                // VALIDASI 2: whitelist content-type
                const allowedContentTypes = [
                    "image/jpeg",
                    "image/png",
                    "application/pdf",
                    "text/plain", // ini buat testing, nanti bisa dihapus di real project
                ];

                if (!allowedContentTypes.includes(contentType)) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(
                        JSON.stringify({
                            error: `Content-Type tidak diizinkan. Yang diperbolehkan: ${allowedContentTypes.join(", ")}`,
                        })
                    );
                    return;
                }

                // VALIDASI 3: sanitize fileName 
                // hapus karakter yang bisa dipakai buat path traversal atau injection
                // hanya izinkan huruf, angka, titik, strip, underscore
                const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");

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
                    fileName: sanitizedFileName,
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

    // ENDPOINT 4: request presigned POST dengan size limit
    if (req.method === "POST" && req.url === "/uploads/request-url-with-limit") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
            try {
                const { fileName, contentType } = JSON.parse(body);

                if (!fileName || typeof fileName !== "string") {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "fileName wajib diisi" }));
                    return;
                }

                const allowedContentTypes = [
                    "image/jpeg",
                    "image/png",
                    "application/pdf",
                    "text/plain",
                ];

                if (!allowedContentTypes.includes(contentType)) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(
                        JSON.stringify({
                            error: `Content-Type tidak diizinkan. Yang diperbolehkan: ${allowedContentTypes.join(", ")}`,
                        })
                    );
                    return;
                }

                const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
                const key = `uploads/${randomUUID()}-${sanitizedFileName}`;

                const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB dalam bytes

                // createPresignedPost beda dari getSignedUrl — dia balikin
                // { url, fields } bukan satu string URL utuh.
                // fields ini WAJIB disertakan client sebagai form-data waktu upload.
                const { url, fields } = await createPresignedPost(s3Client, {
                    Bucket: BUCKET_NAME,
                    Key: key,
                    Conditions: [
                        // ["content-length-range", MIN, MAX] dalam bytes
                        ["content-length-range", 0, MAX_FILE_SIZE],
                        ["eq", "$Content-Type", contentType],
                    ],
                    Fields: {
                        "Content-Type": contentType,
                    },
                    Expires: 300, // 5 menit
                });

                uploadRecords.push({
                    key,
                    fileName: sanitizedFileName,
                    contentType,
                    status: "pending",
                    createdAt: new Date(),
                });

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ url, fields, key }));
            } catch (err) {
                console.error(err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Gagal generate presigned POST" }));
            }
        });
        return;
    }

    // ENDPOINT: request presigned URL buat download
    // if (req.method === "GET" && req.url.startsWith("/uploads/download-url")) {
    //     try {
    //         // ambil query param ?key=... dari URL
    //         const urlObj = new URL(req.url, "http://localhost:3000");
    //         const key = urlObj.searchParams.get("key");

    //         if (!key) {
    //             res.writeHead(400, { "Content-Type": "application/json" });
    //             res.end(JSON.stringify({ error: "Query param 'key' wajib diisi" }));
    //             return;
    //         }

    //         // pastikan file ini beneran pernah tercatat & sudah confirmed
    //         const record = uploadRecords.find((r) => r.key === key);
    //         if (!record || record.status !== "confirmed") {
    //             res.writeHead(404, { "Content-Type": "application/json" });
    //             res.end(JSON.stringify({ error: "File tidak ditemukan atau belum dikonfirmasi" }));
    //             return;
    //         }

    //         const command = new GetObjectCommand({
    //             Bucket: BUCKET_NAME,
    //             Key: key,
    //         });

    //         const downloadUrl = await getSignedUrl(s3Client, command, {
    //             expiresIn: 300,
    //         });

    //         res.writeHead(200, { "Content-Type": "application/json" });
    //         res.end(JSON.stringify({ downloadUrl }));
    //     } catch (err) {
    //         console.error(err);
    //         res.writeHead(500, { "Content-Type": "application/json" });
    //         res.end(JSON.stringify({ error: "Gagal generate download URL" }));
    //     }
    //     return;
    // }
    res.writeHead(404);
    res.end("Not Found");
});

server.listen(3000, () => {
    console.log("Server jalan di http://localhost:3000");
});