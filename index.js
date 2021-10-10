#!/usr/bin/env nodejs

const config = require('./config');
const puppeteer = require('puppeteer-core');
const moment = require('moment');
const nodemailer = require("nodemailer");
const availabilities = {};

async function run() {
    const browser = await puppeteer.launch({
        defaultViewport: null,
        executablePath: process.env.CHROMIUM_PATH,
        // --disable-gpu avoid RPI to freeze on newPage() after one browser close
        args: ['--start-maximized', '--disable-features=site-per-process', '--no-sandbox', '--disable-gpu'],
        headless: true
    });

    async function doJob(config) {

        console.log('Doing ' + config.id)

        if (availabilities[config.id] === undefined) {
            availabilities[config.id] = false;
        }

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36');

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

            // Todo : use https://www.doctolib.fr/availabilities.json?start_date=2021-07-22&visit_motive_ids=2460309&agenda_ids=391618&insurance_sector=public&practice_ids=155768&limit=14

            let excludes = []
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
            await page.click('input[name="telehealth"][value="physicalAppointment"]');
            await page.waitFor(1000);
        }

        if (config.motiveCat) {
            await page.select('#booking_motive_category', config.motiveCat);
            await page.waitFor(1000);
        }

        if (config.motive) {
            await page.select('#booking_motive', config.motive);
        }

        const date = getNextSlot(await getAvail())
        let availability = 0;

        await page.close()

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

        if (config.mail) {
            const newValue = availability === 1 ? true : false;

            if (availabilities[config.id] === false && newValue === true) {

                  const transporter = nodemailer.createTransport({
                    host: config.mail.smtp.host,
                    port: config.mail.smtp.port,
                    secure: config.mail.smtp.port === 465, // true for 465, false for other ports
                    auth: {
                      user: config.mail.smtp.user, // generated ethereal user
                      pass: config.mail.smtp.password, // generated ethereal password
                    }
                  });

                  const text = config.id + ' ' + moment(date).format('YYYY-MM-DD') + ' ' + config.url

                await transporter.sendMail({
                    from: '"Doctolib alert" <localhost>', // sender address
                    to: config.mail.to, // list of receivers
                    subject: "New Doctolib Availability", // Subject line
                    text: text, // plain text body
                    html: "<b>"+text+"</b>", // html body
                  });
            }

            availabilities[config.id] = newValue;
        }
    }

    const security = setTimeout(() => {
        console.log('Closing browser (security anti freeze)')
        browser.close()
    }, config.checks.length * 60 * 1000)

    for(let conf of config.checks) {
        try {
            await doJob({...config, ...conf})
            await new Promise(resolve => setTimeout(resolve, 5000))
        } catch (e) {
            console.error(e)
        }
    }
    await browser.close();
    clearTimeout(security)
    setTimeout(run, (config.frequency || 10 * 60) * 1000);
}

run();
