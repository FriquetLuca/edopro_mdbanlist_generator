# EDOPro Master Duel - Banlist Generator

## Manual Work

Install the project:

```sh
npm install
mkdir -p cdbs
git clone https://github.com/ProjectIgnis/BabelCDB cdbs/BabelCDB
git clone https://github.com/ProjectIgnis/DeltaBagooska cdbs/DeltaBagooska
```

Generate your own Master Duel forbidden / limited list using `NodeJS`.
Put the correct path to your `EDOPro` directory in a `.env` file then run:

```sh
npm run generate
```

Finally drag your newly generated `MasterDuel.lflist.conf` (located in `/lflists`) into the `EDOPro/lflists` directory.

## Automatic Work

Add the following entry in your `EDOPro/config/user_configs.json` file, in the `repos` array:

```json
{
    "url": "https://github.com/FriquetLuca/edopro_mdbanlist_generator",
    "repo_name": "Master Duel Forbidden and Limited List",
    "repo_path": "./repositories/edopro_mdbanlist_generator",
    "has_core": false,
    "lflists_path": "lflists",
    "should_update": true,
    "should_read": true
}
```
