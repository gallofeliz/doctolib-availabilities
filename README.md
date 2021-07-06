# doctolib-availabilities

config.js :

```
module.exports = {
    frequency: 10 * 60,
    browser: {
        headless: true
    },
    influxDB: {
        host: '192.168.1.2',
        database: 'mydb',
        measurement: 'doctolib'
    },
    checks: [
        {
            id: 'x',
            refuseReplace: true, # I want the "true" doctor
            motive: 'Feliz-47',
            url: 'https://www.doctolib.fr/x',
            wantedBefore: '2021-07-12'
        },
        {
            id: 'y',
            alreadySeen: false,
            refuseReplace: true,
            teleHealth: false,
            motive: 'Première consultation-175',
            url: 'https://www.doctolib.fr/y',
            wantedBefore: '2021-07-12'
        },
    ]
};
```
