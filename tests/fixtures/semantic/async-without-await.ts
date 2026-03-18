// @test-compile-error: async function 'getWeather()' called without await

async function getWeather(lat: string): Promise<string> {
  return "sunny";
}

function handleRequest(): string {
  const result = getWeather("37.7");
  return result;
}
