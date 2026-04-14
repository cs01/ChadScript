declare function cs_pg_connect(conninfo: string): string;
declare function cs_pg_status(conn: string): number;
declare function cs_pg_error_message(conn: string): string;
declare function cs_pg_finish(conn: string): void;

const CONNECTION_OK: number = 0;

export class Client {
  private _conninfo: string;
  private _conn: string;
  private _connected: boolean;

  constructor(conninfo: string) {
    this._conninfo = conninfo;
    this._conn = "";
    this._connected = false;
  }

  connect(): void {
    this._conn = cs_pg_connect(this._conninfo);
    const status = cs_pg_status(this._conn);
    if (status !== CONNECTION_OK) {
      const msg = cs_pg_error_message(this._conn);
      cs_pg_finish(this._conn);
      this._connected = false;
      throw new Error("postgres connect failed: " + msg);
    }
    this._connected = true;
  }

  end(): void {
    if (this._connected) {
      cs_pg_finish(this._conn);
      this._connected = false;
    }
  }
}
