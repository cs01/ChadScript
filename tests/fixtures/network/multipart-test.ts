// @test-skip
// Multipart form-data parser test server — used by multipart.test.ts
// Tests parseMultipart(req) for field/file extraction
import { httpServe, parseMultipart } from "chadscript/http";

interface Request {
  method: string;
  path: string;
  body: string;
  contentType: string;
  headers: string;
}

interface Response {
  status: number;
  body: string;
  headers: string;
}

interface MultipartPart {
  name: string;
  filename: string;
  contentType: string;
  data: string;
  dataLen: number;
}

function handleRequest(req: Request): Response {
  if (req.path == "/upload" && req.method == "POST") {
    const parts: MultipartPart[] = parseMultipart(req);
    let result = "count=" + parts.length.toString();

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      result =
        result +
        "\n" +
        "name=" +
        part.name +
        "|filename=" +
        part.filename +
        "|contentType=" +
        part.contentType +
        "|dataLen=" +
        part.dataLen.toString() +
        "|data=" +
        part.data;
    }

    return { status: 200, body: result, headers: "" };
  }

  return { status: 404, body: "Not Found", headers: "" };
}

function getPortNum(): number {
  const args = process.argv;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-p") {
      return parseInt(args[i + 1]);
    }
  }
  return 9987;
}

const port = getPortNum();
httpServe(port, handleRequest);
