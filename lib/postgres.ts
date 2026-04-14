declare function cs_pg_connect(conninfo: string): string;
declare function cs_pg_status(conn: string): number;
declare function cs_pg_error_message(conn: string): string;
declare function cs_pg_finish(conn: string): void;
declare function cs_pg_exec(conn: string, sql: string): string;
declare function cs_pg_result_ok(res: string): number;
declare function cs_pg_result_error_message(res: string): string;
declare function cs_pg_cmdtuples(res: string): string;
declare function cs_pg_clear(res: string): void;
declare function cs_pg_nrows(res: string): number;
declare function cs_pg_ncols(res: string): number;
declare function cs_pg_fname(res: string, col: number): string;
declare function cs_pg_getvalue(res: string, row: number, col: number): string;
declare function cs_pg_getisnull(res: string, row: number, col: number): number;

const CONNECTION_OK: number = 0;

export class Row {
  private _fields: string[];
  private _values: string[];
  private _rowStart: number;
  private _ncols: number;

  constructor(fields: string[], values: string[], rowStart: number, ncols: number) {
    this._fields = fields;
    this._values = values;
    this._rowStart = rowStart;
    this._ncols = ncols;
  }

  get(col: string): string {
    for (let i = 0; i < this._ncols; i++) {
      if (this._fields[i] === col) {
        return this._values[this._rowStart + i];
      }
    }
    return "";
  }

  getAt(col: number): string {
    return this._values[this._rowStart + col];
  }
}

export class QueryResult {
  rowCount: number;
  numRows: number;
  numCols: number;
  fields: string[];
  private _values: string[];

  constructor(
    rowCount: number,
    numRows: number,
    numCols: number,
    fields: string[],
    values: string[],
  ) {
    this.rowCount = rowCount;
    this.numRows = numRows;
    this.numCols = numCols;
    this.fields = fields;
    this._values = values;
  }

  getRow(index: number): Row {
    return new Row(this.fields, this._values, index * this.numCols, this.numCols);
  }

  getValue(row: number, col: string): string {
    for (let i = 0; i < this.numCols; i++) {
      if (this.fields[i] === col) {
        return this._values[row * this.numCols + i];
      }
    }
    return "";
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

    const ncols = cs_pg_ncols(res);
    const fields: string[] = [];
    for (let c = 0; c < ncols; c++) {
      fields.push(cs_pg_fname(res, c));
    }

    const nrows = cs_pg_nrows(res);
    const values: string[] = [];
    for (let r = 0; r < nrows; r++) {
      for (let c = 0; c < ncols; c++) {
        values.push(cs_pg_getvalue(res, r, c));
      }
    }

    const tuplesStr = cs_pg_cmdtuples(res);
    const rowCount = nrows > 0 ? nrows : parseInt(tuplesStr, 10);
    cs_pg_clear(res);
    return new QueryResult(rowCount, nrows, ncols, fields, values);
  }

  end(): void {
    if (this._connected) {
      cs_pg_finish(this._conn);
      this._connected = false;
    }
  }
}
