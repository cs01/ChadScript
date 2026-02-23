// @test-skip
// Multipart form-data parser test server — used by multipart.test.ts
// Tests ChadScript.parseMultipart(req) for field/file extraction

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
    const parts: MultipartPart[] = ChadScript.parseMultipart(req);
    let result = "count=" + parts.length.toString();

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      result =
        result +
        "\n" +
        "name=" + part.name +
        "|filename=" + part.filename +
        "|contentType=" + part.contentType +
        "|dataLen=" + part.dataLen.toString() +
        "|data=" + part.data;
    }

    return { status: 200, body: result, headers: "" };
  }

  return { status: 404, body: "Not Found", headers: "" };
}

httpServe(9987, handleRequest);
