const express = require('express')
const router = express.Router()

const fs = require('fs')
const request = require('request').defaults({ jar: true })
const govukTopics = require('./govuk-topics')
const url = require('url')
const nunjucks = require('nunjucks')

// Add your routes here - above the module.exports line

if (!process.env.API_URL) {
  console.warn('\n\n=== ERROR ============================')
  console.warn('You must set API_URL to specify the URL of the backend API')
  console.warn('for instance: API_URL=http://localhost:3050 npm start')
  console.warn('======================================\n\n')
  process.exit(-1)
}

const API_URL = process.env.API_URL

// ---- pre-fetch all topics titles  and descriptions

let mainstreamTopics, specialistTopics
govukTopics.fetchMainstreamTopics(body => { mainstreamTopics = body })
govukTopics.fetchSpecialistTopics(body => { specialistTopics = body })

// ---- Topic pages (both mainstream and specialist)

const topicPage = function (topicType, req, res) {
  const topicSlug = req.params.topicSlug
  const url = `${API_URL}/${topicType}/${topicSlug}`
  console.log(`requesting ${url}`)
  request(url, { json: true }, (_error, result, body) => {
    body.topicSlug = topicSlug
    if (body.organisations) {
      body.organisations = body.organisations.slice(0, 5)
    }
    if (body.latest_news) {
      body.latest_news = body.latest_news.slice(0, 3)
      body.latest_news.forEach(news => {
        const d = new Date(news.public_timestamp)
        news.date = `${d.getDate()}/${d.getMonth()}/${d.getFullYear()}`
        news.subtopic = news.subtopic === 'other' ? '' : news.subtopic.replace(/_/g, ' ')
        news.topic = news.topic === 'other' ? '' : news.topic.replace(/_/g, ' ')
      })
    }
    if (body.subtopics) {
      // Add the description of each subtopic from the appropriate topics global var
      body.subtopics = body.subtopics.map(sub => {
        console.log('SUBTOPIC')
        console.log(sub)

        // TODO: Hardcoded for now as we're only mocking one specialist topic for now
        if (sub.link === '/browse/visas-immigration/immigration-operational-guidance') {
          return { ...sub, description: 'Immigration Rules, forms and guidance for advisers' }
        }

        const topicList = topicType === 'browse' ? mainstreamTopics : specialistTopics
        return { ...sub, description: topicList.find(topic => topic._id === sub.link).description }
      })
    }
    res.render('topic', body)
  })
}

router.get('/browse/:topicSlug', function (req, res) {
  return topicPage('browse', req, res)
})


router.get('/topic/:topicSlug', function (req, res) {
  return topicPage('topic', req, res)
})

// ---- Mainstream subtopics

router.get('/browse/:topicSlug/:subTopicSlug', function (req, res) {
  const topicSlug = req.params.topicSlug
  const subTopicSlug = req.params.subTopicSlug
  const url = `${API_URL}/browse/${topicSlug}/${subTopicSlug}`
  console.log(`requesting ${url}`)
  request(url, { json: true }, (_error, result, body) => {
    body.topicSlug = topicSlug
    if (body.organisations) {
      body.organisations = body.organisations.slice(0, 5)
    }
    if (body.latest_news) {
      body.latest_news = body.latest_news.slice(0, 3)
      body.latest_news.forEach(news => {
        const d = new Date(news.public_timestamp)
        news.date = `${d.getDate()}/${d.getMonth()}/${d.getFullYear()}`
        news.subtopic = news.subtopic === 'other' ? '' : news.subtopic.replace(/_/g, ' ')
        news.topic = news.topic === 'other' ? '' : news.topic.replace(/_/g, ' ')
      })
    }
    res.render('sub_topic', body)
  })
})

// ---- Specialist subtopics

router.get('/topic/:topicSlug/:subTopicSlug', function (req, res) {
  const topicSlug = req.params.topicSlug
  const subTopicSlug = req.params.subTopicSlug
  const url = `${API_URL}/topic/${topicSlug}/${subTopicSlug}`
  console.log(`requesting ${url}`)
  request(url, { json: true }, (_error, result, body) => {
    body.topicSlug = topicSlug
    if (body.subtopics) {
      body.subtopics = body.subtopics.sort((a, b) => {
        if (a.title.toLowerCase() < b.title.toLowerCase()) return -1
        if (a.title > b.title) return 1
        return 0
      })
    }
    res.render('sub_topic', body)
  })
})

// ----------------------

router.get('/topic', function (req, res) {
  const url = `${API_URL}/topic`
  console.log(`requesting ${url}`)
  request(url, { json: true }, (error, results, body) => {
    if (error) throw error
    res.render('topics', body)
  })
})

router.get('/', function (req, res) {
  res.render('index')
})

// ==================================================
// All other URLs

// If content is an "end of journey" content type, return the generic content template
// Otherwise, modify the body of all pages returned from gov.uk to add the Explore elements
const augmentedBody = function (req, response, body) {
  const footerTemplate = fs.readFileSync('app/views/explore-footer.html', 'utf8')

  // Make all src and ref attributes absolute, or the server will try to
  // fetch its own version
  return body
    .replace(/(href|src)="\//g, '$1="https://www.gov.uk/')
    .replace(/<body( class=")*?/, '<body class="explore-body"')
    .replace(/<footer[^]+?<\/footer>/, footerTemplate)
    .replace(
      '<div class="govuk-header__container govuk-width-container">',
      '<div class="govuk-header__container govuk-header__container--old-page govuk-width-container">')
    .replace(/<a(.*) href\s*=\s*(['"])\s*(https:)?\/\/www.gov.uk\//g,'<a $1 href=$2/')
}

// Constructs the URL to get the page body from on gov.uk
const govUkUrl = function (req) {
  var urlParts = new URL(req.url, 'https://www.gov.uk')
  var query = urlParts.search
  return 'https://www.gov.uk' + req.path + (query? query : '')
}

router.get('/*', function (req,res) {
  const supportedDocumentTypes = [
    'consultation',
    'detailed_guide',
    'document_collection',
    'guide',
    'html_publication',
    'local_transaction',
    'publication',
  ]
  const originalUrl = req.originalUrl

  const contentApiUrl = `https://www.gov.uk/api/content/${originalUrl}`
  request(contentApiUrl, { json: true }, (error, result, body) => {
    if (error) throw error
    const contentType = body.schema_name
    
    if (supportedDocumentTypes.includes(contentType)) {
      const isHtmlPub = contentType === 'html_publication'
      const protoApiUrl = `${API_URL}/generic?slug=${originalUrl}&htmlpub=${isHtmlPub}`

      request(protoApiUrl, { json: true }, (error, result, body) => {
        if (error) throw error
        res.render((isHtmlPub ? 'html_publication' : 'generic_template'), body)
      })
    } else {
      request(govUkUrl(req), function (error, response, body) {
        if (error) throw error
        if (response.headers['content-type'].indexOf('application/json') !== -1) {
          res.json(JSON.parse(body))
        } else {
          res.send(augmentedBody(req, response, body))
        }
      })
    }
  })
})

router.post('/*', function (req, res) {
  request.post({
    url: govUkUrl(req),
    followAllRedirects: true,
    formData: req.body
  }, function (error, response, body) {
    if (error) throw error

    res.send(augmentedBody(req, response, body))
  })
})

module.exports = router
