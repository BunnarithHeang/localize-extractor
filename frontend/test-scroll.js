import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  // Create a minimal reproduction of the layout
  await page.setContent(`
    <style>
      body, html { margin: 0; height: 100vh; overflow: hidden; display: flex; flex-direction: column; }
      #root { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
      .main-layout { display: flex; flex: 1; overflow: hidden; }
      .workspace { flex: 1; display: block; text-align: center; padding: 2rem; overflow: auto; min-height: 0; height: 100%; background: #ccc; }
      .wrapper { display: inline-block; text-align: center; min-width: 100%; }
      .canvas-container { position: relative; display: inline-block; zoom: 1.5; background: red; }
      img { display: block; width: 400px; height: 800px; }
    </style>
    <div id="root">
      <div class="main-layout">
        <main class="workspace" id="ws">
          <div class="wrapper">
            <div class="canvas-container">
              <img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" />
            </div>
          </div>
        </main>
      </div>
    </div>
  `);

  const info = await page.evaluate(() => {
    const ws = document.getElementById('ws');
    return {
      clientHeight: ws.clientHeight,
      scrollHeight: ws.scrollHeight,
      canScroll: ws.scrollHeight > ws.clientHeight
    };
  });
  console.log(info);
  await browser.close();
})();
