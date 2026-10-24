/**
 * 内存数据库兜底：未配置 Supabase 凭据时使用（演示/体验模式，服务重启即清空）。
 * 仅实现本项目 index.ts 用到的最小查询子集，接口形状与 supabase-js 对齐：
 *   db.from(t).select(cols).eq(c,v).order(c,{ascending}).limit(n) → await → {data,error}
 *   db.from(t).insert(obj|arr).select(cols).single() / maybeSingle()
 *   db.from(t).update(patch).eq(c,v) / db.from(t).delete().eq(c,v)
 */
type Row = Record<string, any>;

const tables = new Map<string, Row[]>();
function table(name: string): Row[] {
  if (!tables.has(name)) tables.set(name, []);
  return tables.get(name)!;
}
// settings 表预置一行（单用户自用）
table("settings").push({ id: 1, pin_hash: null, growth_mode: "canned", moderation: true });

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function clone<T>(v: T): T {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

class Builder {
  private op: "select" | "insert" | "update" | "delete" | undefined;
  private tableName: string;
  private filters: { col: string; val: any; op?: "gte" | "lte" }[] = [];
  private orderCol?: string;
  private orderAsc = true;
  private limitN?: number;
  private payload?: any;
  private wantSingle = false;
  private wantMaybeSingle = false;
  private returnRows = false;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  select(_cols?: string) {
    if (!this.op) this.op = "select";
    else this.returnRows = true; // insert(...).select(...)
    return this;
  }
  insert(payload: any) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: any) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, val: any) {
    this.filters.push({ col, val });
    return this;
  }
  gte(col: string, val: any) {
    this.filters.push({ col, val, op: "gte" });
    return this;
  }
  lte(col: string, val: any) {
    this.filters.push({ col, val, op: "lte" });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderCol = col;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  single() {
    this.wantSingle = true;
    return this;
  }
  maybeSingle() {
    this.wantMaybeSingle = true;
    return this;
  }

  private exec(): { data: any; error: any } {
    if (!this.op) return { data: null, error: { message: "no operation" } };
    const rows = table(this.tableName);
    if (this.op === "insert") {
      const values = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = values.map((v) => {
        const row = { ...clone(v) };
        if (row.id == null) row.id = newId();
        rows.push(row);
        return row;
      });
      let data: any = this.returnRows ? clone(inserted) : null;
      // 对齐 supabase-js：insert(...).select(...).single() 返回对象而非数组
      if (this.returnRows && this.wantSingle) data = inserted.length ? clone(inserted[0]) : null;
      else if (this.returnRows && this.wantMaybeSingle) data = inserted.length ? clone(inserted[0]) : null;
      return { data, error: null };
    }
    const match = (r: Row) =>
      this.filters.every((f) => {
        if (f.op === "gte") return String(r[f.col] ?? "") >= String(f.val);
        if (f.op === "lte") return String(r[f.col] ?? "") <= String(f.val);
        return r[f.col] === f.val;
      });
    if (this.op === "update") {
      let n = 0;
      for (const r of rows) {
        if (match(r)) {
          Object.assign(r, clone(this.payload));
          n++;
        }
      }
      if (n === 0) return { data: null, error: { message: "no matching row", code: "PGRST116" } };
      return { data: null, error: null };
    }
    if (this.op === "delete") {
      const keep = rows.filter((r) => !match(r));
      tables.set(this.tableName, keep);
      return { data: null, error: null };
    }
    // select
    let out = rows.filter(match).map(clone);
    if (this.orderCol) {
      out.sort((a, b) => {
        const av = a[this.orderCol!] ?? "";
        const bv = b[this.orderCol!] ?? "";
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return this.orderAsc ? cmp : -cmp;
      });
    }
    if (this.limitN != null) out = out.slice(0, this.limitN);
    if (this.wantSingle) {
      return out.length ? { data: out[0], error: null } : { data: null, error: { message: "no rows", code: "PGRST116" } };
    }
    if (this.wantMaybeSingle) {
      return { data: out.length ? out[0] : null, error: null };
    }
    return { data: out, error: null };
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    let result: { data: any; error: any };
    try {
      result = this.exec();
    } catch (e: any) {
      return Promise.reject(e).then(onfulfilled as any, onrejected as any);
    }
    return Promise.resolve(result).then(onfulfilled as any, onrejected as any);
  }
}

/** 与 supabase-js 客户端同形状的内存实现：db.from(t).select/insert/update/delete(...) */
export const memoryDb = {
  from(name: string): any {
    return new Builder(name);
  },
};
