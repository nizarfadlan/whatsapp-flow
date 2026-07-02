# Storage

Storage defaults to local disk. Set S3 variables only when you want direct uploads to S3, R2, or MinIO.

## Local

```env
PUBLIC_BASE_URL=http://localhost:3000
STORAGE_DRIVER=local
LOCAL_UPLOAD_DIR=uploads
```

Files are written to `LOCAL_UPLOAD_DIR` and served from `${PUBLIC_BASE_URL}/uploads/<key>`.

## S3 / R2 / MinIO

```env
STORAGE_DRIVER=s3
S3_ENDPOINT=http://localhost:9000
S3_REGION=auto
S3_BUCKET={bucket_name}
S3_ACCESS_KEY_ID={access_key_id}
S3_SECRET_ACCESS_KEY={secret_access_key}
S3_PUBLIC_URL=https://cdn.example.com
```

`S3_ENDPOINT` is optional for AWS S3. `S3_PUBLIC_URL` is optional; without it, public URLs use the AWS bucket URL.

If `STORAGE_DRIVER` is not set, the package uses S3 only when bucket, region, access key, and secret key are all present. Otherwise it uses local storage.
