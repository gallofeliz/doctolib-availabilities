# doctolib-availabilities

Notify (to mail but you can easily plug another notifier) you when a close date is available for your doctor.

Configure yours doctors, for example one :

```
  {
      id: 'my-general-doctor',
      url: 'https://www.doctolib.fr/medecin-generaliste/paris/mister-poop',
      teleHealth: true,
      wantedBefore: 7,
      motive: '5536533'
  }
```

The system will notify you when your general doctor is available in the next 7 days. You will then notified on a planning change (no spam).

Example of mail :

`my-general-doctor 2022-03-03 https://www.doctolib.fr/medecin-generaliste/paris/mister-poop`

You can so easily click on the link in your mail and check that the hour is good for you and book !

See docker-compose for an example.

## Note

Turn off headless with `sudo HEADLESS=false docker-compose up`

Display (X11) support is not mandatory in default case of headless true.
