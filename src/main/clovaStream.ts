import { EventEmitter } from 'node:events';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const PROTO_SOURCE = `syntax = "proto3";
package com.nbp.cdncp.nest.grpc.proto.v1;
service NestService {
  rpc recognize(stream NestRequest) returns (stream NestResponse) {}
}
enum RequestType {
  CONFIG = 0;
  DATA = 1;
}
message NestConfig { string config = 1; }
message NestData { bytes chunk = 1; string extra_contents = 2; }
message NestRequest {
  RequestType type = 1;
  NestConfig config = 2;
  NestData data = 3;
}
message NestResponse { string contents = 1; }`;

type NestServiceClient = grpc.Client & {
  recognize: () => grpc.ClientDuplexStream<NestRequest, NestResponse>;
};

interface NestRequest {
  type: number;
  config?: { config: string };
  data?: { chunk: Buffer; extra_contents: string };
}

interface NestResponse {
  contents: string;
}

let cachedClientCtor: grpc.ServiceClientConstructor | null = null;

function loadNestClient(): grpc.ServiceClientConstructor {
  if (cachedClientCtor) return cachedClientCtor;
  const dir = mkdtempSync(join(tmpdir(), 'rtdoctor-clova-'));
  const path = join(dir, 'nest.proto');
  writeFileSync(path, PROTO_SOURCE, 'utf8');

  const pkg = protoLoader.loadSync(path, {
    keepCase: true,
    longs: String,
    enums: Number,
    defaults: true,
    oneofs: true
  });
  const def = grpc.loadPackageDefinition(pkg);
  const NestService =
    (def as any)?.com?.nbp?.cdncp?.nest?.grpc?.proto?.v1?.NestService;
  if (!NestService) throw new Error('NestService not found in proto');
  cachedClientCtor = NestService as grpc.ServiceClientConstructor;
  return cachedClientCtor;
}

export interface ClovaStreamHandle {
  sendAudio(chunk: Buffer, seqId: number): void;
  stop(): void;
  on(event: 'partial' | 'final', listener: (text: string) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'close', listener: () => void): this;
}

class ClovaStreamSession extends EventEmitter implements ClovaStreamHandle {
  private call: grpc.ClientDuplexStream<NestRequest, NestResponse>;
  private closed = false;

  constructor(call: grpc.ClientDuplexStream<NestRequest, NestResponse>) {
    super();
    this.call = call;
    call.on('data', (resp: NestResponse) => this.handleResponse(resp));
    call.on('error', (err) => {
      if (this.closed && (err as any).code === grpc.status.CANCELLED) return;
      this.emit('error', err);
    });
    call.on('end', () => this.emit('close'));
  }

  private handleResponse(resp: NestResponse): void {
    if (!resp?.contents) return;
    let parsed: any;
    try {
      parsed = JSON.parse(resp.contents);
    } catch {
      return;
    }
    const types: string[] = parsed.responseType ?? [];
    if (types.includes('transcription') && parsed.transcription) {
      const t = parsed.transcription;
      const text: string = t.text ?? '';
      if (!text) return;
      const epd = t.epdType as string | undefined;
      // endPoint / period / durationThreshold = final; gap = ongoing partial
      if (epd && epd !== 'gap') {
        this.emit('final', text);
      } else {
        this.emit('partial', text);
      }
    } else if (types.includes('recognize') && parsed.recognize?.status) {
      this.emit('error', new Error(`CLOVA: ${parsed.recognize.status}`));
    }
  }

  sendAudio(chunk: Buffer, seqId: number): void {
    if (this.closed) return;
    this.call.write({
      type: 1,
      data: {
        chunk,
        extra_contents: JSON.stringify({ seqId, epFlag: false })
      }
    });
  }

  stop(): void {
    if (this.closed) return;
    this.closed = true;
    // Signal end-of-speech to the server (epFlag=true) so it flushes any
    // pending partial as a final transcript.
    try {
      this.call.write({
        type: 1,
        data: {
          chunk: Buffer.alloc(0),
          extra_contents: JSON.stringify({ seqId: -1, epFlag: true })
        }
      });
    } catch {
      /* ignore */
    }
    // Half-close the stream so the server can deliver remaining responses.
    try {
      this.call.end();
    } catch {
      /* ignore */
    }
    // Give the server a moment to deliver the tail before cancelling.
    setTimeout(() => {
      try {
        this.call.cancel();
      } catch {
        /* ignore */
      }
    }, 2000);
  }
}

export function hasClovaSpeechSecret(): boolean {
  return !!process.env.CLOVA_SPEECH_SECRET;
}

export async function openClovaStream(): Promise<ClovaStreamHandle> {
  const secret = process.env.CLOVA_SPEECH_SECRET;
  if (!secret) {
    throw new Error(
      'CLOVA_SPEECH_SECRET가 .env에 없습니다. CLOVA Speech 장문 인식 도메인에서 발급받아 설정하세요.'
    );
  }

  const ClientCtor = loadNestClient();
  const target = 'clovaspeech-gw.ncloud.com:50051';

  const callCreds = grpc.credentials.createFromMetadataGenerator(
    (_params, callback) => {
      const metadata = new grpc.Metadata();
      metadata.add('authorization', `Bearer ${secret}`);
      callback(null, metadata);
    }
  );
  const channelCreds = grpc.credentials.combineChannelCredentials(
    grpc.credentials.createSsl(),
    callCreds
  );

  const client = new ClientCtor(target, channelCreds) as unknown as NestServiceClient;
  const call = client.recognize();

  const session = new ClovaStreamSession(call);

  const config = {
    transcription: { language: 'ko' },
    semanticEpd: {
      skipEmptyText: false,
      useWordEpd: false,
      usePeriodEpd: true,
      gapThreshold: 500,
      durationThreshold: 20000,
      syllableThreshold: 0
    }
  };
  call.write({ type: 0, config: { config: JSON.stringify(config) } });

  return session;
}
