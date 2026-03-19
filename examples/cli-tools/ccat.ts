import { ArgumentParser } from "chadscript/argparse";

const parser = new ArgumentParser(
  "ccat",
  "View files with line numbers and syntax highlighting — like bat, but blazing fast",
);
parser.addFlag("plain", "p", "Plain output, no decorations");
parser.addFlag("no-color", "C", "Disable syntax highlighting");
parser.addFlag("show-all", "A", "Show non-printable characters");
parser.addOption("range", "r", "Line range to display (e.g. 10:20)", "");
parser.addOption("language", "l", "Force language for highlighting", "");
parser.addPositional("file", "File to display (reads stdin if omitted)");
parser.parse(process.argv);

const filePath = parser.getPositional(0);
const plain = parser.getFlag("plain");
const noColor = parser.getFlag("no-color");
const showAllChars = parser.getFlag("show-all");
const rangeStr = parser.getOption("range");
const forceLang = parser.getOption("language");

const colorReset = "\x1b[0m";
const colorGray = "\x1b[90m";
const colorGreen = "\x1b[32m";
const colorYellow = "\x1b[33m";
const colorCyan = "\x1b[36m";
const colorMagenta = "\x1b[35m";
const colorRed = "\x1b[31m";
const colorBlue = "\x1b[34m";
const colorBold = "\x1b[1m";
const colorDim = "\x1b[2m";
const bgGray = "\x1b[48;5;236m";

let content = "";
let fileName = "";
if (filePath.length === 0) {
  content = process.stdin.read();
  fileName = "STDIN";
} else {
  content = fs.readFileSync(filePath);
  fileName = filePath;
}

const lines = content.split("\n");

let startLine = 1;
let endLine = lines.length;
if (rangeStr.length > 0) {
  const colonIdx = rangeStr.indexOf(":");
  if (colonIdx !== -1) {
    const startStr = rangeStr.substring(0, colonIdx);
    const endStr = rangeStr.substring(colonIdx + 1, rangeStr.length);
    if (startStr.length > 0) startLine = parseInt(startStr);
    if (endStr.length > 0) endLine = parseInt(endStr);
  } else {
    startLine = parseInt(rangeStr);
    endLine = startLine;
  }
}

function detectLanguage(file: string): string {
  if (forceLang.length > 0) return forceLang;
  if (file.endsWith(".ts") || file.endsWith(".tsx")) return "typescript";
  if (file.endsWith(".js") || file.endsWith(".jsx")) return "javascript";
  if (file.endsWith(".py")) return "python";
  if (file.endsWith(".rs")) return "rust";
  if (file.endsWith(".go")) return "go";
  if (file.endsWith(".c") || file.endsWith(".h")) return "c";
  if (file.endsWith(".cpp") || file.endsWith(".hpp")) return "cpp";
  if (file.endsWith(".java")) return "java";
  if (file.endsWith(".json")) return "json";
  if (file.endsWith(".yaml") || file.endsWith(".yml")) return "yaml";
  if (file.endsWith(".sh") || file.endsWith(".bash")) return "shell";
  if (file.endsWith(".md")) return "markdown";
  if (file.endsWith(".css")) return "css";
  if (file.endsWith(".html")) return "html";
  if (file.endsWith(".sql")) return "sql";
  if (file.endsWith(".toml")) return "toml";
  return "text";
}

const lang = detectLanguage(fileName);

const keywords_ts =
  "const,let,var,function,class,interface,type,import,export,from,return,if,else,while,for,of,in,new,this,async,await,try,catch,throw,finally,switch,case,break,continue,default,extends,implements,static,private,public,protected,void,null,undefined,true,false,typeof,instanceof,as,enum,readonly,abstract,declare,module,namespace,require";
const keywords_py =
  "def,class,import,from,return,if,elif,else,while,for,in,try,except,finally,raise,with,as,lambda,pass,break,continue,yield,async,await,True,False,None,and,or,not,is,del,global,nonlocal,assert";
const keywords_rs =
  "fn,let,mut,const,struct,enum,impl,trait,use,mod,pub,return,if,else,while,for,in,loop,match,self,Self,super,crate,async,await,move,ref,type,where,unsafe,extern,static,dyn,true,false,as,break,continue";
const keywords_go =
  "func,var,const,type,struct,interface,import,package,return,if,else,for,range,switch,case,break,continue,default,defer,go,chan,select,map,make,new,nil,true,false,append,len,cap";
const keywords_c =
  "int,char,void,float,double,long,short,unsigned,signed,struct,enum,union,typedef,return,if,else,while,for,do,switch,case,break,continue,default,sizeof,static,extern,const,volatile,inline,register,auto,goto,NULL,true,false,include,define,ifdef,ifndef,endif,pragma";
const keywords_sql =
  "SELECT,FROM,WHERE,INSERT,INTO,VALUES,UPDATE,SET,DELETE,CREATE,TABLE,DROP,ALTER,INDEX,JOIN,LEFT,RIGHT,INNER,OUTER,ON,AND,OR,NOT,IN,BETWEEN,LIKE,ORDER,BY,GROUP,HAVING,LIMIT,OFFSET,AS,DISTINCT,COUNT,SUM,AVG,MIN,MAX,NULL,PRIMARY,KEY,FOREIGN,REFERENCES,UNIQUE,CHECK,DEFAULT,CASCADE,EXISTS,UNION,ALL,ANY,CASE,WHEN,THEN,ELSE,END,IS,INTEGER,TEXT,REAL,BLOB,VARCHAR,BOOLEAN";
const keywords_sh =
  "if,then,elif,else,fi,while,do,done,for,in,case,esac,function,return,exit,echo,read,local,export,source,set,unset,shift,break,continue,true,false,test";
const keywords_java =
  "public,private,protected,static,final,abstract,class,interface,extends,implements,import,package,return,if,else,while,for,switch,case,break,continue,default,new,this,super,void,int,long,double,float,char,boolean,byte,short,try,catch,throw,throws,finally,synchronized,volatile,transient,native,enum,instanceof,null,true,false";

function getKeywords(): string {
  if (lang === "typescript" || lang === "javascript") return keywords_ts;
  if (lang === "python") return keywords_py;
  if (lang === "rust") return keywords_rs;
  if (lang === "go") return keywords_go;
  if (lang === "c" || lang === "cpp") return keywords_c;
  if (lang === "sql") return keywords_sql;
  if (lang === "shell") return keywords_sh;
  if (lang === "java") return keywords_java;
  return "";
}

const kwString = getKeywords();
const kwList = kwString.split(",");

function isKeyword(word: string): boolean {
  let i = 0;
  while (i < kwList.length) {
    if (kwList[i] === word) return true;
    i = i + 1;
  }
  return false;
}

function isAlpha(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$";
}

function isAlphaNum(ch: string): boolean {
  return isAlpha(ch) || (ch >= "0" && ch <= "9");
}

function highlightLine(line: string): string {
  if (noColor || lang === "text") return line;

  let result = "";
  let pos = 0;

  while (pos < line.length) {
    const ch = line.charAt(pos);

    if (ch === "/" && pos + 1 < line.length && line.charAt(pos + 1) === "/") {
      result = result + colorGray + line.substring(pos, line.length) + colorReset;
      pos = line.length;
      continue;
    }

    if (
      ch === "#" &&
      (lang === "python" || lang === "shell" || lang === "yaml" || lang === "toml")
    ) {
      result = result + colorGray + line.substring(pos, line.length) + colorReset;
      pos = line.length;
      continue;
    }

    if (ch === "-" && pos + 1 < line.length && line.charAt(pos + 1) === "-" && lang === "sql") {
      result = result + colorGray + line.substring(pos, line.length) + colorReset;
      pos = line.length;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let end = pos + 1;
      while (end < line.length) {
        if (line.charAt(end) === "\\") {
          end = end + 2;
          continue;
        }
        if (line.charAt(end) === quote) {
          end = end + 1;
          break;
        }
        end = end + 1;
      }
      result = result + colorGreen + line.substring(pos, end) + colorReset;
      pos = end;
      continue;
    }

    if (ch >= "0" && ch <= "9") {
      let end = pos;
      while (
        end < line.length &&
        ((line.charAt(end) >= "0" && line.charAt(end) <= "9") ||
          line.charAt(end) === "." ||
          line.charAt(end) === "x" ||
          line.charAt(end) === "b")
      ) {
        end = end + 1;
      }
      result = result + colorMagenta + line.substring(pos, end) + colorReset;
      pos = end;
      continue;
    }

    if (isAlpha(ch)) {
      let end = pos;
      while (end < line.length && isAlphaNum(line.charAt(end))) {
        end = end + 1;
      }
      const word = line.substring(pos, end);
      if (isKeyword(word)) {
        result = result + colorRed + word + colorReset;
      } else if (end < line.length && line.charAt(end) === "(") {
        result = result + colorBlue + word + colorReset;
      } else if (word.charAt(0) >= "A" && word.charAt(0) <= "Z") {
        result = result + colorCyan + word + colorReset;
      } else {
        result = result + word;
      }
      pos = end;
      continue;
    }

    if (ch === "@") {
      let end = pos + 1;
      while (end < line.length && isAlphaNum(line.charAt(end))) {
        end = end + 1;
      }
      result = result + colorYellow + line.substring(pos, end) + colorReset;
      pos = end;
      continue;
    }

    result = result + ch;
    pos = pos + 1;
  }

  return result;
}

function showNonPrintable(line: string): string {
  if (!showAllChars) return line;
  let result = "";
  let i = 0;
  while (i < line.length) {
    const ch = line.charAt(i);
    if (ch === "\t") {
      result = result + colorGray + "\u2192   " + colorReset;
    } else if (ch === "\r") {
      result = result + colorGray + "\u240d" + colorReset;
    } else {
      result = result + ch;
    }
    i = i + 1;
  }
  return result;
}

const totalDigits = ("" + lines.length).length;

function padLineNum(n: number): string {
  const s = "" + n;
  let result = "";
  let p = 0;
  while (p < totalDigits - s.length) {
    result = result + " ";
    p = p + 1;
  }
  return result + s;
}

if (!plain) {
  const langLabel = lang === "text" ? "" : " \u2022 " + lang;
  if (noColor) {
    console.log(
      "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    );
    console.log(" File: " + fileName + langLabel);
    console.log(
      "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    );
  } else {
    console.log(
      colorDim +
        "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500" +
        colorReset,
    );
    console.log(colorBold + " File: " + fileName + colorReset + colorGray + langLabel + colorReset);
    console.log(
      colorDim +
        "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500" +
        colorReset,
    );
  }
}

let lineIdx = startLine - 1;
while (lineIdx < endLine && lineIdx < lines.length) {
  let line = lines[lineIdx];
  line = showNonPrintable(line);
  line = highlightLine(line);

  if (plain) {
    console.log(line);
  } else {
    if (noColor) {
      console.log(" " + padLineNum(lineIdx + 1) + " \u2502 " + line);
    } else {
      console.log(" " + colorGray + padLineNum(lineIdx + 1) + " \u2502" + colorReset + " " + line);
    }
  }
  lineIdx = lineIdx + 1;
}

if (!plain) {
  if (noColor) {
    console.log(
      "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    );
  } else {
    console.log(
      colorDim +
        "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500" +
        colorReset,
    );
  }
}
