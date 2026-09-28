import { expect, test } from '@playwright/test';
import { registerAndToken } from './helpers';

test('roster: 25 account names pasted, cards printed, codes are gone after reload', async ({ page }) => {
  await registerAndToken(page);
  await page.getByRole('link', { name: 'Třídy' }).click();
  await page.getByTestId('new-class').click();
  await page.getByTestId('class-name').fill('8.A Fyzika');
  await page.getByTestId('create-class').click();
  await expect(page.getByTestId('class-title')).toHaveText('8.A Fyzika');
  const list = Array.from({ length: 25 }, (_, i) => `${i + 1}. zak${String(i + 1).padStart(2, '0')}@skola.cz`).join('\n');
  await page.getByTestId('roster-text').fill(list);
  await page.getByTestId('roster-preview').click();
  await expect(page.getByTestId('roster-preview-table')).toContainText('zak01');
  await expect(page.getByTestId('roster-preview-table')).not.toContainText('skola.cz');
  await page.getByTestId('roster-commit').click();
  await expect(page.getByTestId('plain-code')).toHaveCount(25);
  const first = await page.getByTestId('plain-code').first().textContent();
  expect(first).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('print-cards').click();
  await expect(page.getByTestId('roster-table').locator('tbody tr')).toHaveCount(25);
  page.once('dialog', (d) => d.accept()); // beforeunload
  await page.reload();
  await page.getByTestId('tab-roster').click();
  await expect(page.getByTestId('roster-table').locator('tbody tr')).toHaveCount(25);
  await expect(page.getByTestId('plain-code')).toHaveCount(0);
  expect(await page.content()).not.toContain(first!);
});

test('tisk karet: pod kartami nezůstává prázdná stránka', async ({ page }) => {
  await registerAndToken(page);
  await page.getByRole('link', { name: 'Třídy' }).click();
  await page.getByTestId('new-class').click();
  await page.getByTestId('class-name').fill('9.A Tisk');
  await page.getByTestId('create-class').click();
  await expect(page.getByTestId('class-title')).toHaveText('9.A Tisk');
  // dlouhá soupiska, krátký výtisk – přesně ten případ, kdy dřív vypadly prázdné stránky
  await page.getByTestId('roster-text').fill(Array.from({ length: 28 }, (_, i) => `zak${String(i + 1).padStart(2, '0')}`).join('\n'));
  await page.getByTestId('roster-preview').click();
  await page.getByTestId('roster-commit').click();
  await expect(page.getByTestId('plain-code')).toHaveCount(28);

  // na kartě musí být i adresa k ručnímu opsání, QR kód sám o sobě stačit nemůže
  const prvni = page.locator('.code-card').first();
  await expect(prvni).toContainText('Přihlaš se na');
  await expect(prvni).toContainText(`${new URL(page.url()).host}/play`);
  await expect(prvni.locator('img')).toHaveCount(1);

  await page.emulateMedia({ media: 'print' });
  const m = await page.evaluate(() => {
    const plocha = document.querySelector('.print-area') as HTMLElement;
    return {
      vyskaDokumentu: document.documentElement.scrollHeight,
      vyskaPlochy: Math.round(plocha.getBoundingClientRect().height),
      vyskaOkna: window.innerHeight,
      // nic mimo tiskovou plochu (a mimo její předky) nesmí při tisku zabírat místo
      zbytek: [...document.querySelectorAll('body *')].filter(
        (e) => !e.closest('.print-area') && !e.querySelector('.print-area') && e.getBoundingClientRect().height > 0,
      ).length,
    };
  });
  expect(m.zbytek).toBe(0);
  // dokument je vysoký jako karty (nebo jako okno, když jsou karty nižší), ne o soupisku víc
  expect(m.vyskaDokumentu).toBeLessThanOrEqual(Math.max(m.vyskaPlochy, m.vyskaOkna) + 4);
  await page.emulateMedia({ media: 'screen' });
});

test('CSV import from AD: only the login and the number are sent to the server (C4.3)', async ({ page }) => {
  await registerAndToken(page);
  await page.getByRole('link', { name: 'Třídy' }).click();
  await page.getByTestId('new-class').click();
  await page.getByTestId('class-name').fill('8.C Import');
  await page.getByTestId('create-class').click();
  await expect(page.getByTestId('class-title')).toHaveText('8.C Import');
  const bodies: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/classes/') && r.method() === 'POST') bodies.push(r.postData() ?? '');
  });
  await page.getByRole('tab', { name: 'Import CSV' }).click();
  const csv = 'GivenName;Surname;SamAccountName;cislo;mail\nJarmila;Kvasničková;kvasnickova1;1;kvasnickova1@zs-hornidolni.cz\nBohuslav;Šťovíček;STOVICEK2;2;stovicek2@zs-hornidolni.cz\n';
  await page.getByTestId('roster-file').setInputFiles({ name: '8C.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await page.getByTestId('roster-preview').click();
  const table = page.getByTestId('roster-preview-table');
  await expect(table).toContainText('kvasnickova1');
  await expect(table).toContainText('stovicek2');
  await expect(table).not.toContainText('Jarmila');
  await page.getByTestId('roster-commit').click();
  await expect(page.getByTestId('plain-code')).toHaveCount(2);
  const sent = bodies.find((b) => b.includes('students'))!;
  expect(JSON.parse(sent)).toEqual({ students: [{ accountName: 'kvasnickova1', rosterNo: 1 }, { accountName: 'stovicek2', rosterNo: 2 }] });
  for (const w of ['Jarmila', 'Kvasničková', 'Bohuslav', 'zs-hornidolni']) expect(bodies.join('')).not.toContain(w);
});
