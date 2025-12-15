# KTP NIK Extractor API

API untuk ekstraksi NIK dari KTP menggunakan OCR Space.

## Instalasi

```bash
npm install
```

## Menjalankan Server

```bash
npm start
```

atau untuk development dengan auto-reload:

```bash
npm run dev
```

Server akan berjalan di `http://localhost:3000`

## API Endpoints

### 1. Extract NIK dari Base64 atau URL

**POST** `/extract-nik`

**Body:**
```json
{
  "image": "data:image/jpeg;base64,/9j/4AAQSkZJRg... atau https://example.com/ktp.jpg",
  "type": "base64"
}
```

**Response (Success):**
```json
{
  "success": true,
  "nik": "1234567890123456",
  "ktpInfo": {
    "nama": "John Doe",
    "tempatLahir": "Jakarta",
    "tanggalLahir": "01-01-1990",
    "alamat": "Jl. Merdeka No. 123",
    "jenisKelamin": "Laki-laki",
    "agama": "Islam"
  },
  "fullText": "...",
  "confidence": 0.95
}
```

### 2. Extract NIK dari File Upload

**POST** `/extract-nik-file`

**Body:** multipart/form-data
- `file`: KTP image file

**Response:** Same as endpoint 1

### 3. Health Check

**GET** `/health`

**Response:**
```json
{
  "status": "OK",
  "message": "KTP NIK Extractor API is running"
}
```

### 4. API Documentation

**GET** `/`

Menampilkan dokumentasi API endpoints.

## Contoh Penggunaan

### Menggunakan cURL dengan File

```bash
curl -X POST http://localhost:3000/extract-nik-file \
  -F "file=@path/to/ktp.jpg"
```

### Menggunakan cURL dengan Base64

```bash
curl -X POST http://localhost:3000/extract-nik \
  -H "Content-Type: application/json" \
  -d '{
    "image": "data:image/jpeg;base64,YOUR_BASE64_STRING",
    "type": "base64"
  }'
```

### Menggunakan Node.js

```javascript
const axios = require('axios');
const fs = require('fs');

// Method 1: Using file
const formData = new FormData();
formData.append('file', fs.createReadStream('ktp.jpg'));

axios.post('http://localhost:3000/extract-nik-file', formData)
  .then(response => console.log(response.data))
  .catch(error => console.error(error));

// Method 2: Using base64
const imageBase64 = fs.readFileSync('ktp.jpg').toString('base64');

axios.post('http://localhost:3000/extract-nik', {
  image: `data:image/jpeg;base64,${imageBase64}`,
  type: 'base64'
})
  .then(response => console.log(response.data))
  .catch(error => console.error(error));
```

### Menggunakan Python

```python
import requests

# Method 1: Using file
files = {'file': open('ktp.jpg', 'rb')}
response = requests.post('http://localhost:3000/extract-nik-file', files=files)
print(response.json())

# Method 2: Using base64
import base64

with open('ktp.jpg', 'rb') as f:
    image_base64 = base64.b64encode(f.read()).decode()

data = {
    'image': f'data:image/jpeg;base64,{image_base64}',
    'type': 'base64'
}
response = requests.post('http://localhost:3000/extract-nik', json=data)
print(response.json())
```

## Fitur

- ✅ Ekstraksi NIK dari KTP (16 digit)
- ✅ Ekstraksi informasi KTP tambahan (Nama, Tempat Lahir, Tanggal Lahir, Alamat, Jenis Kelamin, Agama)
- ✅ Support upload file atau base64/URL
- ✅ Menggunakan OCR Space dengan engine 1
- ✅ Language: Indonesian (ind)
- ✅ CORS enabled

## API Key

API Key yang digunakan: `--`

Anda dapat mengganti API key di file `server.js` pada baris:
```javascript
const API_KEY = '--';
```

## Error Handling

API akan mengembalikan error dalam format:
```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error message"
}
```

HTTP Status Codes:
- `200`: Success
- `400`: Bad request (missing file, error processing image)
- `500`: Server error

## Dependencies

- `express`: Web framework
- `axios`: HTTP client untuk OCR Space API
- `form-data`: Untuk multipart form data
- `multer`: Untuk file upload handling
- `cors`: Untuk CORS support
- `nodemon`: Untuk development (optional)
