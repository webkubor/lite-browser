/**
 * cdp.ts —— 原生 WebSocket 驱动的高性能 CDP 客户端
 */

export class CdpClient {
  public wsUrl: string;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void; timer: any; method: string }>();
  private listeners = new Map<string, Set<(params: any) => void>>();
  public isConnected = false;

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl;
  }

  async connect(timeoutMs = 10000): Promise<void> {
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.ws) {
          try { this.ws.close(); } catch (_) {}
        }
        reject(new Error(`连接 CDP 超时 (${timeoutMs}ms): ${this.wsUrl}`));
      }, timeoutMs);

      try {
        this.ws = new WebSocket(this.wsUrl);
      } catch (err: any) {
        clearTimeout(timer);
        return reject(new Error(`WebSocket 初始化失败: ${err.message}`));
      }

      this.ws.onopen = () => {
        clearTimeout(timer);
        this.isConnected = true;
        resolve();
      };

      this.ws.onerror = (err: any) => {
        if (!this.isConnected) {
          clearTimeout(timer);
          reject(new Error(`WebSocket 连接错误: ${err.message || 'connection failed'}`));
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        for (const [id, req] of this.pending.entries()) {
          clearTimeout(req.timer);
          req.reject(new Error('CDP 连接已关闭'));
          this.pending.delete(id);
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);
          this._handleMessage(data);
        } catch (err: any) {
          console.error('[cdp] 消息解析异常:', err.message);
        }
      };
    });
  }

  async send<T = any>(method: string, params: Record<string, any> = {}, timeoutMs = 30000): Promise<T> {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 调用超时 (${timeoutMs}ms): ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer, method });
      this.ws!.send(payload);
    });
  }

  on(event: string, callback: (params: any) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => this.off(event, callback);
  }

  off(event: string, callback: (params: any) => void): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(callback);
    }
  }

  async waitFor<T = any>(event: string, timeoutMs = 15000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`等待 CDP 事件超时 (${timeoutMs}ms): ${event}`));
      }, timeoutMs);

      const callback = (params: any) => {
        cleanup();
        resolve(params);
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.off(event, callback);
      };

      this.on(event, callback);
    });
  }

  private _handleMessage(data: any): void {
    if (typeof data.id === 'number') {
      const req = this.pending.get(data.id);
      if (req) {
        clearTimeout(req.timer);
        this.pending.delete(data.id);
        if (data.error) {
          const err: any = new Error(`CDP 错误 (${req.method}): ${data.error.message || JSON.stringify(data.error)}`);
          err.code = data.error.code;
          req.reject(err);
        } else {
          req.resolve(data.result);
        }
      }
      return;
    }

    if (data.method) {
      const set = this.listeners.get(data.method);
      if (set) {
        for (const cb of set) {
          try { cb(data.params); } catch (e) { console.error(`[cdp] 事件回调异常 (${data.method}):`, e); }
        }
      }
    }
  }

  close(): void {
    this.isConnected = false;
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
    for (const [id, req] of this.pending.entries()) {
      clearTimeout(req.timer);
      req.reject(new Error('CDP 已主动断开'));
      this.pending.delete(id);
    }
  }
}
