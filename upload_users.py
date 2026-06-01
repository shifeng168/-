import json
import hmac
import hashlib
import base64
import time
import urllib.request

# Qiniu credentials (from app code)
AK = "Vs7xlCcbstiRqPEBJjVHAbZN1cy-0VOADHqf4-xo"
SK = "_GA7yvTXUqN25w6lJ74_H3OzeM6hir0a39Nfa0wH"
BUCKET = "wangqingyou"
CDN_DOMAIN = "yoyobaby.asia"
UPLOAD_URL = "https://up-na0.qiniup.com"

def b64url(data):
    """Match browser btoa behavior: base64 with + and / replaced, keeping padding"""
    encoded = base64.b64encode(data).decode()
    return encoded.replace('+', '-').replace('/', '_')

def generate_upload_token(bucket, key, deadline):
    """Generate Qiniu upload token"""
    policy = {
        "scope": f"{bucket}:{key}",
        "deadline": deadline
    }
    policy_json = json.dumps(policy, separators=(',', ':'))
    encoded_policy = b64url(policy_json.encode())
    
    signature = hmac.new(
        SK.encode(),
        encoded_policy.encode(),
        hashlib.sha1
    ).digest()
    encoded_signature = b64url(signature)
    
    return f"{AK}:{encoded_signature}:{encoded_policy}"

# Read users.json
with open(r'C:\Users\Administrator\users.json', 'r', encoding='utf-8') as f:
    users_data = f.read()

# Generate token (expires in 1 hour)
deadline = int(time.time()) + 3600
token = generate_upload_token(BUCKET, "users.json", deadline)

# Upload to Qiniu
import io
boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"

body = (
    f"--{boundary}\r\n"
    f'Content-Disposition: form-data; name="token"\r\n\r\n'
    f"{token}\r\n"
    f"--{boundary}\r\n"
    f'Content-Disposition: form-data; name="key"\r\n\r\n'
    f"users.json\r\n"
    f"--{boundary}\r\n"
    f'Content-Disposition: form-data; name="file"; filename="users.json"\r\n'
    f"Content-Type: application/json\r\n\r\n"
    f"{users_data}\r\n"
    f"--{boundary}--\r\n"
).encode('utf-8')

req = urllib.request.Request(
    UPLOAD_URL,
    data=body,
    headers={
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    },
    method="POST"
)

try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read().decode())
        print("Upload response:", json.dumps(result, indent=2, ensure_ascii=False))
        
        if "key" in result:
            print(f"\n✓ users.json uploaded successfully!")
            print(f"  CDN URL: https://{CDN_DOMAIN}/users.json")
        else:
            print(f"\n✗ Upload failed: {result}")
except Exception as e:
    print(f"Upload error: {e}")
