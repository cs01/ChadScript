declare function cs_pg_connect(conninfo: string): string;
declare function cs_pg_status(conn: string): number;
declare function cs_pg_error_message(conn: string): string;
declare function cs_pg_finish(conn: string): void;
declare function cs_pg_exec(conn: string, sql: string): string;
declare function cs_pg_result_ok(res: string): number;
declare function cs_pg_result_error_message(res: string): string;
declare function cs_pg_cmdtuples(res: string): string;
declare function cs_pg_clear(res: string): void;

const CONNECTION_OK: number = 0;

export class QueryResult {
  rowCount: number;
  constructor(rowCount: number) {
    this.rowCount = rowCount;
  }
}

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

  query(sql: string): QueryResult {
    if (!this._connected) {
      throw new Error("postgres query on disconnected client");
    }
    const res = cs_pg_exec(this._conn, sql);
    const ok = cs_pg_result_ok(res);
    if (ok === 0) {
      const msg = cs_pg_result_error_message(res);
      cs_pg_clear(res);
      throw new Error("postgres query failed: " + msg);
    }
    const tuplesStr = cs_pg_cmdtuples(res);
    const rowCount = parseInt(tuplesStr, 10);
    cs_pg_clear(res);
    return new QueryResult(rowCount);
  }

  end(): void {
    if (this._connected) {
      cs_pg_finish(this._conn);
      this._connected = false;
    }
  }
}
