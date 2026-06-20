const isValidUrl = require("../../utils/isValidUrl")

describe("check isValidUrl Method",()=>{
    it("http url success check",()=>{
        const url = "http://www.google.com"
        const response = isValidUrl(url)
        expect(response).toBe(true)
    })

    it("https url success check",()=>{
        const url = "https://www.google.com"
        const response = isValidUrl(url)
        expect(response).toBe(true)
    })

 

    it("malformed string reject",()=>{
        const url = "www.google.com"
        const response = isValidUrl(url)
        expect(response).toBe(false)
    })

    it("empty string reject",()=>{
        const url = ""
        const response = isValidUrl(url)
        expect(response).toBe(false)
    })

    it("unsupported protocols reject",()=>{
        const url = "ftp://www.google.com"
        const response = isValidUrl(url)
        expect(response).toBe(false)
    })
})