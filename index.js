const Database = require('better-sqlite3');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config({
  path: path.resolve(process.cwd(), '.env'),
  quiet: true,
});

if(!process.env.EDOPRO_PATH) {
    console.error("no `EDOPRO_PATH` found");
    process.exit(1);
}

const EDOPRO_PATH = path.resolve(process.env.EDOPRO_PATH);


const EXPANSIONS_PATH = path.join(EDOPRO_PATH, 'expansions');
const DELTA_BAGOOSKA_PATH = path.join(EDOPRO_PATH, 'repositories/delta-bagooska');

const bagFiles = fs.readdirSync(DELTA_BAGOOSKA_PATH)
    .filter(file => file.endsWith('.cdb'))
    .map(file => ({
        filename: file,
        nameWithoutExt: path.parse(file).name,
        sqlAlias: `db_${path.parse(file).name.replace(/[^a-zA-Z0-9_]/g, '_')}`,
        fullPath: path.join(DELTA_BAGOOSKA_PATH, file)
    }));
const expFiles = fs.readdirSync(EXPANSIONS_PATH)
    .filter(file => file.endsWith('.cdb'))
    .map(file => ({
        filename: file,
        nameWithoutExt: path.parse(file).name,
        sqlAlias: `db_${path.parse(file).name.replace(/[^a-zA-Z0-9_]/g, '_')}`,
        fullPath: path.join(EXPANSIONS_PATH, file)
    }));

const cdbFiles = [...bagFiles, ...expFiles];

if (cdbFiles.length === 0) {
    console.log("no .cdb found in the specified EDOPRO_PATH");
    process.exit(0);
}

function findDBItem(searchTerm = 'Blue-Eyes White Dragon') {
    try {
        const pattern = `%${searchTerm.trim().replace(/\s+/g, '%')}%`;
        const sql = `
            SELECT 
                id, 
                name, 
                CASE 
                    WHEN INSTR(name, '(') > 0 THEN RTRIM(SUBSTR(name, 1, INSTR(name, '(') - 1))
                    ELSE name 
                END AS refinedName
            FROM texts 
            WHERE name LIKE ?
        `;
        const allResults = [];
        for (const cdb of cdbFiles) {
            const tempDb = new Database(cdb.fullPath, { readonly: true });
            const rows = tempDb.prepare(sql).all(pattern);
            tempDb.close();
            allResults.push(...rows);
        }
        return allResults;
    } catch (error) {
        console.error('Erreur lors de l\'exécution de la requête :', error.message);
    }
}

function parseAndFormatDate(dateStr) {
    if (!dateStr) return 'MasterDuel';
    // Remove ordinal suffixes like th, st, nd, rd (e.g. 5th -> 5)[cite: 1]
    const cleaned = dateStr.replace(/(\d+)(st|nd|rd|th)/i, '$1');
    const d = new Date(cleaned);
    if (isNaN(d.getTime())) return 'MasterDuel';
    
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function crawlBanlist() {
    if(!process.env.MASTER_DUEL_LIST_LINK) {
        console.error("no `MASTER_DUEL_LIST_LINK` found");
        process.exit(1);
    }
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    });    
    const page = await browser.newPage();    
    try {
        await page.goto(process.env.MASTER_DUEL_LIST_LINK, { waitUntil: 'networkidle2', timeout: 60 * 60000 });
        const banlistData = await page.evaluate(() => {
            const dateEl = document.querySelector('div.selectedItem div.selection') || document.querySelector('#aria-selection');
            let rawDateText = dateEl ? dateEl.textContent.trim() : '';
            if (rawDateText.startsWith('Option ')) {
                rawDateText = rawDateText.replace('Option ', '').replace(', selected.', '').trim();
            }
            const mainElement = document.querySelector('body > div > main > div');
            if (!mainElement) return null;
            const children = Array.from(mainElement.children);
            const sections = [[], [], []]; 
            let currentSectionIndex = -1;
            for (const el of children) {
                if (el.tagName === 'H3') {
                    currentSectionIndex++;
                }                
                if (el.tagName === 'DIV' && currentSectionIndex >= 0 && currentSectionIndex < 3) {
                    const cardLinks = el.querySelectorAll('a[href^="/cards/"]');                    
                    cardLinks.forEach(link => {
                        const href = link.getAttribute('href');
                        const rawName = href.replace('/cards/', '');
                        const cleanName = decodeURIComponent(rawName);                        
                        sections[currentSectionIndex].push(cleanName);
                    });
                }
            }
            return {
                rawDateText,
                forbidden: sections[0] || [],
                limited: sections[1] || [],
                semiLimited: sections[2] || []
            };
        });
        if (!banlistData) {
            throw new Error("Unable to target the main container.");
        }
        return banlistData;
    } catch (error) {
        console.error('Erreur lors du crawling :', error.message);
    } finally {
        await browser.close();
    }
}

function normalizeName(name) {
    return name
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase();
}
function pushToDocument(mdDocument, listLabel, currentList, limit) {
    if(currentList.length > 0) {
        mdDocument.push(listLabel);
        for(const cardName of currentList) {
            const cards = findDBItem(cardName);
            if(cards && cards.length > 0) {
                const targetNormalized = normalizeName(cardName);
                const correctCards = cards.filter(card => 
                    normalizeName(card.refinedName) === targetNormalized ||
                    normalizeName(card.name) === targetNormalized
                );
                if(correctCards.length === 0) {
                    console.log(`card not found: ${cardName}`);
                } else {
                    const idSet = new Set();
                    correctCards.sort((a, b) => Number(a.id) - Number(b.id));
                    correctCards.forEach(card => {
                        if(idSet.has(card.id)) return;
                        mdDocument.push(`${card.id} ${limit} --${card.refinedName}`);
                        idSet.add(card.id);
                    });
                }
            } else {
                console.log(`card not found: ${cardName}`);
            }
        }
    }
}

async function createMasterDuelLflists() {
    const banlist = await crawlBanlist();
    if(!banlist) {
        console.error("no banlist found");
        process.exit(1);
    }
    const formattedDate = parseAndFormatDate(banlist.rawDateText);
    const mdDocument = [
        `#[${formattedDate} MasterDuel]`, 
        `!${formattedDate} MasterDuel`
    ];
    pushToDocument(mdDocument, '#Forbidden', banlist.forbidden, 0);
    pushToDocument(mdDocument, '#Limited', banlist.limited, 1);
    pushToDocument(mdDocument, '#Semi-limited', banlist.semiLimited, 2);
    const outputPath = path.resolve(process.cwd(), 'lflists/MasterDuel.lflist.conf');
    fs.writeFileSync(outputPath, mdDocument.join('\n'), 'utf-8');
    console.log('Master Duel forbidden / limited list successfully generated');
}

createMasterDuelLflists();
