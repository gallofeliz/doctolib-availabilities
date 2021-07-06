#!/usr/bin/env nodejs

const config = require('./config');
const puppeteer = require('puppeteer');
const Influx = require('influx');
const moment = require('moment');

async function run() {
    const browser = await puppeteer.launch({
        defaultViewport: null,
        args: ['--start-maximized', '--disable-features=site-per-process'],
        headless: config.browser.headless
    });

    async function doJob(config) {

        const page = await browser.newPage();

        await page.setViewport({ width: 1280, height: 800 })

        async function getAvail() {

            return new Promise((resolve) => {
                let handler;
                page.on('response', handler = response => {
                    const isXhr = ['xhr','fetch'].includes(response.request().resourceType())
                    const isAvail = response.url().includes('availabilities.json')
                    if (isXhr && isAvail){

                        response.text().then(text => resolve(JSON.parse(text)))
                        page.off('response', handler)
                    }
                })

                setTimeout(() => page.off('response', handler), 60 * 1000)

            })

        }

        function getNextSlot(avail) {
            if (avail.next_slot) {
                return avail.next_slot;
            }

            let exludes = []
            if (config.refuseReplace) {
                avail.availabilities.forEach(day => {
                    Object.values(day.substitution || {}).forEach(sub => {
                        excludes = excludes.concat(sub.slots)
                    })
                })
            }

            const dispo = avail.availabilities.find(day => day.slots.filter(slot => !excludes.includes(slot)).length > 0)
            return dispo ? dispo.date : null
        }

        await page.goto(config.url);

        await page.waitFor(2000)
        try {
            await page.click('#didomi-notice-agree-button');
        } catch (e) {
        }
        await page.waitFor(1000);


        if (config.alreadySeen === false) {
            await page.click('label[for=all_visit_motives-1]');
            await page.waitFor(1000);
        }

        if (config.teleHealth === false) {
            await page.click('input[name="telehealth"][value="false"]');
            await page.waitFor(1000);
        }

        if (config.motive) {
            await page.select('#booking_motive', config.motive);
        }

        const date = getNextSlot(await getAvail())
        let availability = 0;

        if (date) {
            let maxDate = config.wantedBefore;
            if (typeof config.wantedBefore === 'number') {
                maxDate = moment().add(config.wantedBefore, 'days').format('YYYY-MM-DD')
            }

            if (date < maxDate) {
                availability = 1;
            }
        }

        console.log('next date', config.id, date)

        if (config.influxDB) {

            const influx = new Influx.InfluxDB(config.influxDB)

            influx.writePoints([
              {
                measurement: config.influxDB.measurement,
                fields: {
                    availability
                },
                tags: {
                    id: config.id
                }
              }
            ])

        } else {
            console.log('availability', config.id, availability)
        }

    }

    for(let conf of config.checks) {
        try {
            await doJob({...config, ...conf})
        } catch (e) {
            console.error(e)
        }
    }
    await browser.close();
}

setInterval(run, (config.frequency || 10 * 60) * 1000);
run();
