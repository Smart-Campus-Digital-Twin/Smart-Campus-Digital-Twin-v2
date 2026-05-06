import yaml, base64

with open('deployment/k8s/secrets.yaml', 'r') as f:
    docs = list(yaml.safe_load_all(f))

for doc in docs:
    if doc.get('metadata', {}).get('name') == 'api-env':
        doc['data']['CORS_ORIGINS'] = base64.b64encode(b'["http://localhost:3000", "http://localhost:3001", "http://campus.local"]').decode()

with open('deployment/k8s/secrets.yaml', 'w') as f:
    yaml.dump_all(docs, f)
