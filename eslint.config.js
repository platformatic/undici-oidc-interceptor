const neostandard = require('neostandard')

module.exports = [...neostandard(), { files: ['tests/*.js'], rules: { camelcase: 0 } }]
