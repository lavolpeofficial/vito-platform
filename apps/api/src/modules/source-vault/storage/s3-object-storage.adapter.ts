import { Injectable } from '@nestjs/common';
import { createHash, createHmac } from 'crypto';
import { request } from 'https';
import { ObjectStoragePort, PutObjectInput, StoredObject } from './object-storage.port';

interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function sha256Hex(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function amzTimestamp(date: Date): { full: string; short: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { full: iso, short: iso.slice(0, 8) };
}

@Injectable()
export class S3ObjectStorageAdapter implements ObjectStoragePort {
  private config(): S3Config {
    const endpoint = process.env.SOURCE_VAULT_S3_ENDPOINT?.replace(/\/$/, '');
    const region = process.env.SOURCE_VAULT_S3_REGION;
    const bucket = process.env.SOURCE_VAULT_S3_BUCKET;
    const accessKeyId = process.env.SOURCE_VAULT_S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.SOURCE_VAULT_S3_SECRET_ACCESS_KEY;

    if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error('SOURCE VAULT S3 ist gewählt, aber Endpoint/Region/Bucket/Credentials sind unvollständig.');
    }
    if (!endpoint.startsWith('https://')) {
      throw new Error('SOURCE_VAULT_S3_ENDPOINT muss https:// verwenden.');
    }
    return { endpoint, region, bucket, accessKeyId, secretAccessKey };
  }

  private sanitizeSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 240) || 'unnamed';
  }

  private keyFor(input: PutObjectInput): string {
    return ['raw', this.sanitizeSegment(input.organizationId), this.sanitizeSegment(input.sourceId), this.sanitizeSegment(input.filename)].join('/');
  }

  private parseUri(storageUri: string): { bucket: string; key: string } {
    if (!storageUri.startsWith('s3://')) throw new Error('S3ObjectStorageAdapter erwartet s3:// URI.');
    const rest = storageUri.slice(5);
    const slash = rest.indexOf('/');
    if (slash <= 0 || slash === rest.length - 1) throw new Error('Ungültige S3 Storage URI.');
    return { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) };
  }

  private async signedRequest(method: 'PUT' | 'GET' | 'HEAD' | 'DELETE', key: string, body = Buffer.alloc(0), extraHeaders: Record<string, string> = {}) {
    const config = this.config();
    const timestamp = amzTimestamp(new Date());
    const endpoint = new URL(config.endpoint);
    const canonicalUri = `/${rfc3986(config.bucket)}/${key.split('/').map(rfc3986).join('/')}`;
    const payloadHash = sha256Hex(body);
    const host = endpoint.host;

    const signedHeaderNames = ['host', 'x-amz-content-sha256', 'x-amz-date'];
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${timestamp.full}\n`;
    const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaderNames.join(';'), payloadHash].join('\n');
    const scope = `${timestamp.short}/${config.region}/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${timestamp.full}\n${scope}\n${sha256Hex(canonicalRequest)}`;

    const kDate = hmac(`AWS4${config.secretAccessKey}`, timestamp.short);
    const kRegion = hmac(kDate, config.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames.join(';')}, Signature=${signature}`;

    const url = new URL(canonicalUri, `${endpoint.protocol}//${endpoint.host}`);
    const headers: Record<string, string | number> = {
      Host: host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': timestamp.full,
      Authorization: authorization,
      ...extraHeaders,
    };
    if (body.length > 0) headers['Content-Length'] = body.length;

    return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>((resolve, reject) => {
      const req = request(url, { method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      if (body.length > 0) req.write(body);
      req.end();
    });
  }

  async putImmutable(input: PutObjectInput): Promise<StoredObject> {
    const config = this.config();
    const key = this.keyFor(input);
    const uri = `s3://${config.bucket}/${key}`;
    if (await this.exists(uri)) throw new Error(`Immutable SOURCE VAULT object existiert bereits: ${uri}`);

    const response = await this.signedRequest('PUT', key, input.body, { 'Content-Type': input.mimeType });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`S3 PUT fehlgeschlagen (${response.status}): ${response.body.toString('utf8').slice(0, 500)}`);
    }
    const etag = typeof response.headers.etag === 'string' ? response.headers.etag : undefined;
    return { storageUri: uri, byteSize: input.body.byteLength, etag };
  }

  async exists(storageUri: string): Promise<boolean> {
    const config = this.config();
    const { bucket, key } = this.parseUri(storageUri);
    if (bucket !== config.bucket) throw new Error('S3 URI verweist auf einen anderen als den konfigurierten Bucket.');
    const response = await this.signedRequest('HEAD', key);
    if (response.status === 404) return false;
    if (response.status >= 200 && response.status < 300) return true;
    throw new Error(`S3 HEAD fehlgeschlagen (${response.status}).`);
  }

  async get(storageUri: string): Promise<Buffer> {
    const config = this.config();
    const { bucket, key } = this.parseUri(storageUri);
    if (bucket !== config.bucket) throw new Error('S3 URI verweist auf einen anderen als den konfigurierten Bucket.');
    const response = await this.signedRequest('GET', key);
    if (response.status === 404) throw new Error('S3 Object nicht gefunden.');
    if (response.status < 200 || response.status >= 300) throw new Error(`S3 GET fehlgeschlagen (${response.status}).`);
    return response.body;
  }

  async delete(storageUri: string): Promise<void> {
    const config = this.config();
    const { bucket, key } = this.parseUri(storageUri);
    if (bucket !== config.bucket) throw new Error('S3 URI verweist auf einen anderen als den konfigurierten Bucket.');
    const response = await this.signedRequest('DELETE', key);
    if (response.status === 404 || response.status === 204 || (response.status >= 200 && response.status < 300)) return;
    throw new Error(`S3 DELETE fehlgeschlagen (${response.status}).`);
  }
}
